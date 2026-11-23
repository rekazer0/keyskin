package io.github.rekazer0.keyskin.share

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Base64
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@InvokeArg
class ShareFileArgs {
  lateinit var path: String
  lateinit var name: String
  lateinit var mimeType: String
}

@InvokeArg
class ObserveInsetsArgs {
  lateinit var handler: Channel
}

@InvokeArg
class ObserveSourceArgs {
  lateinit var uri: String
  lateinit var handler: Channel
}

@Keep
class SourceFileArg {
  var path: String = ""
  var data: String = ""
}

@InvokeArg
class CreateWorkspaceArgs {
  lateinit var uri: String
  lateinit var name: String
  var files: List<SourceFileArg> = emptyList()
  var sourceLimit: Int? = null
}

@InvokeArg
class PickSkinFileArgs {
  var initialUri: String? = null
}

@InvokeArg
class DeleteSkinArgs {
  lateinit var uri: String
  var source: String? = null
}

@InvokeArg
class WorkspaceArgs {
  lateinit var uri: String
}

@Keep
class SourceChangeArg {
  var path: String = ""
  var data: List<Int>? = null
}

@InvokeArg
class ApplyChangesArgs {
  lateinit var uri: String
  var changes: List<SourceChangeArg> = emptyList()
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  private class SkinApp(val name: String, val extensions: Set<String>, val packages: List<Pair<String, String>>)

  companion object {
    // 包名需同步写进 AndroidManifest.xml 的 <queries>，否则 Android 11+ 查不到已安装的应用。
    private val SKIN_APPS = listOf(
      SkinApp("百度输入法", setOf("bdi", "bds", "bda"), listOf(
        "百度输入法（com.baidu.input）" to "com.baidu.input",
        "百度输入法小米版（com.baidu.input_mi）" to "com.baidu.input_mi",
      )),
      SkinApp("搜狗输入法", setOf("ssf"), listOf(
        "搜狗输入法（com.sohu.inputmethod.sogou）" to "com.sohu.inputmethod.sogou",
        "搜狗输入法小米版（com.sohu.inputmethod.sogou.xiaomi）" to "com.sohu.inputmethod.sogou.xiaomi",
        "搜狗输入法 vivo 版（com.sohu.inputmethod.sogou.vivo）" to "com.sohu.inputmethod.sogou.vivo",
        "搜狗输入法定制版（com.sohu.inputmethod.sogouoem）" to "com.sohu.inputmethod.sogouoem",
      )),
    )
    private const val MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
    private const val SOURCE_MARKER = ".keyskin-source"
    private const val SOURCE_MARKER_CONTENT = "KeySkin source workspace\n"
    private const val MAX_SOURCE_FILES = 4096
    private const val MAX_SOURCE_BYTES = 256L * 1024 * 1024
  }

  private var sourceObserver: ContentObserver? = null
  private var sourcePoll: ScheduledFuture<*>? = null
  private val sourceExecutor = Executors.newSingleThreadExecutor()
  private val sourcePollExecutor = Executors.newSingleThreadScheduledExecutor()

  private var appWebView: WebView? = null

  override fun load(webView: WebView) {
    appWebView = webView
  }

  @Command
  fun observeWindowInsets(invoke: Invoke) {
    val args = invoke.parseArgs(ObserveInsetsArgs::class.java)
    activity.runOnUiThread {
      val view = appWebView
      if (view == null) {
        invoke.reject("WebView is unavailable")
        return@runOnUiThread
      }
      val decor = activity.window.decorView
      var last: Map<String, Int>? = null
      fun send(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val position = IntArray(2)
        view.getLocationInWindow(position)
        val bottomGap = decor.height - position[1] - view.height
        val result = mapOf(
          "top" to (bars.top - position[1]).coerceAtLeast(0),
          "bottom" to (bars.bottom - bottomGap).coerceAtLeast(0),
          "left" to (bars.left - position[0]).coerceAtLeast(0),
          "right" to (bars.right - (decor.width - position[0] - view.width)).coerceAtLeast(0),
          "ime" to (insets.getInsets(WindowInsetsCompat.Type.ime()).bottom - bottomGap).coerceAtLeast(0),
        )
        if (result != last) {
          last = result
          args.handler.sendObject(result)
        }
      }
      ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
        send(insets)
        ViewCompat.onApplyWindowInsets(target, insets)
      }
      ViewCompat.getRootWindowInsets(view)?.let(::send)
      invoke.resolve()
    }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    appWebView = null
    try {
      clearSourceObserver()
    } finally {
      sourcePollExecutor.shutdownNow()
      // Let an in-flight save finish without leaving idle workers retaining the Activity.
      sourceExecutor.shutdown()
      super.onDestroy(activity)
    }
  }

  private fun runSourceIO(invoke: Invoke, fallbackMessage: String, operation: () -> Any?) {
    sourceExecutor.execute {
      try {
        val result = operation()
        activity.runOnUiThread {
          if (result == null) invoke.resolve() else invoke.resolveObject(result)
        }
      } catch (error: Exception) {
        activity.runOnUiThread {
          invoke.reject(error.message ?: fallbackMessage, error)
        }
      }
    }
  }

  @Command
  fun shareFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ShareFileArgs::class.java)
      val file = File(args.path)
      if (!file.isFile) {
        invoke.reject("Shared skin file does not exist")
        return
      }

      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        file,
      )
      val extension = file.extension.lowercase()
      val app = SKIN_APPS.firstOrNull { extension in it.extensions }
      if (app == null) {
        // 手心 Android 只接收 .piska，.sxi 没有可直接导入的应用，交给系统分享。
        val send = Intent(Intent.ACTION_SEND).apply {
          type = args.mimeType
          putExtra(Intent.EXTRA_STREAM, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        openSkin(invoke, Intent.createChooser(send, args.name), "没有可接收此皮肤的应用")
        return
      }
      // 百度、搜狗都以 VIEW 接收 content:// 下的皮肤文件（按扩展名匹配，MIME 为 */*）。
      val targets = app.packages.map { (label, packageName) ->
        label to Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, args.mimeType)
          setPackage(packageName)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      }.filter { (_, intent) ->
        activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
      }
      val unsupported = "当前${app.name}版本不支持导入皮肤"
      when (targets.size) {
        0 -> invoke.reject("未安装支持导入皮肤的${app.name}")
        1 -> openSkin(invoke, targets[0].second, unsupported)
        else -> AlertDialog.Builder(activity)
          .setTitle("选择${app.name}")
          .setItems(targets.map { it.first }.toTypedArray()) { _, index ->
            openSkin(invoke, targets[index].second, unsupported)
          }
          .setOnCancelListener { invoke.reject("已取消导入皮肤") }
          .show()
      }
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Unable to share skin", error)
    }
  }

  private fun openSkin(invoke: Invoke, intent: Intent, unsupported: String) {
    try {
      activity.startActivity(intent)
      invoke.resolve()
    } catch (error: ActivityNotFoundException) {
      invoke.reject(unsupported, error)
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Unable to share skin", error)
    }
  }

  @Command
  fun pickSourceDirectory(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
          Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
      )
      putExtra(
        DocumentsContract.EXTRA_INITIAL_URI,
        Uri.parse("content://com.android.externalstorage.documents/document/primary%3AKeySkin"),
      )
    }
    startActivityForResult(invoke, intent, "sourceDirectoryResult")
  }

  @Command
  fun pickSkinFile(invoke: Invoke) {
    val args = invoke.parseArgs(PickSkinFileArgs::class.java)
    // ACTION_OPEN_DOCUMENT 可以拿到持久读写授权；系统默认的 ACTION_GET_CONTENT 只给读权限，保存会被拒。
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      args.initialUri?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(it)) }
    }
    startActivityForResult(invoke, intent, "skinFileResult")
  }

  @ActivityCallback
  fun skinFileResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.reject("File picker cancelled")
      return
    }
    try {
      activity.contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      )
      invoke.resolveObject(uri.toString())
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Unable to access selected file", error)
    }
  }

  @ActivityCallback
  fun sourceDirectoryResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.reject("Directory selection cancelled")
      return
    }
    try {
      val flags = result.data?.flags?.and(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      ) ?: 0
      activity.contentResolver.takePersistableUriPermission(uri, flags)
      val directory = DocumentFile.fromTreeUri(activity, uri)
      if (directory == null || !directory.isDirectory || !directory.canWrite()) {
        invoke.reject("Selected directory is not writable")
        return
      }
      invoke.resolveObject(uri.toString())
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Unable to access selected directory", error)
    }
  }

  @Command
  fun startSourceObserver(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ObserveSourceArgs::class.java)
      clearSourceObserver()
      sourceObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean, uri: Uri?) {
          args.handler.sendObject(uri?.toString() ?: args.uri)
        }
      }
      val uri = Uri.parse(args.uri)
      activity.contentResolver.registerContentObserver(uri, true, sourceObserver!!)
      var snapshot: Map<String, String>? = null
      sourcePoll = sourcePollExecutor.scheduleWithFixedDelay({
        try {
          val next = sourceSnapshot(uri)
          if (snapshot != null && snapshot != next) {
            activity.runOnUiThread { args.handler.sendObject(args.uri) }
          }
          snapshot = next
        } catch (_: Exception) {
        }
      }, 0, 1200, TimeUnit.MILLISECONDS)
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Unable to watch source directory", error)
    }
  }

  private fun clearSourceObserver() {
    sourceObserver?.let { activity.contentResolver.unregisterContentObserver(it) }
    sourceObserver = null
    sourcePoll?.cancel(false)
    sourcePoll = null
  }

  @Command
  fun stopSourceObserver(invoke: Invoke) {
    clearSourceObserver()
    invoke.resolve()
  }

  private fun sourceSnapshot(root: Uri): Map<String, String> {
    val output = mutableMapOf<String, String>()
    fun walk(parent: Uri, prefix: String) {
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(
        parent,
        DocumentsContract.getDocumentId(parent),
      )
      val directories = mutableListOf<Pair<Uri, String>>()
      activity.contentResolver.query(
        children,
        arrayOf(
          DocumentsContract.Document.COLUMN_DOCUMENT_ID,
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_MIME_TYPE,
          DocumentsContract.Document.COLUMN_LAST_MODIFIED,
          DocumentsContract.Document.COLUMN_SIZE,
        ),
        null,
        null,
        null,
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val id = cursor.getString(0)
          val name = cursor.getString(1)
          val mime = cursor.getString(2)
          val path = if (prefix.isEmpty()) name else "$prefix/$name"
          output[path] = "$mime:${cursor.getLong(3)}:${cursor.getLong(4)}"
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            directories += DocumentsContract.buildDocumentUriUsingTree(parent, id) to path
          }
        }
      }
      directories.forEach { (uri, path) -> walk(uri, path) }
    }
    walk(root, "")
    return output
  }

  private fun safeParts(path: String): List<String> {
    val parts = path.split('/').filter { it.isNotEmpty() }
    if (parts.isEmpty() || parts.any { it == "." || it == ".." || it.contains('\\') }) {
      throw IllegalArgumentException("Unsafe source path: $path")
    }
    return parts
  }

  private fun directory(uri: String): DocumentFile =
    DocumentFile.fromTreeUri(activity, Uri.parse(uri))
      ?.takeIf { it.isDirectory }
      ?: throw IllegalArgumentException("Source directory is unavailable")

  private fun ensureDirectory(root: DocumentFile, parts: List<String>): DocumentFile {
    var current = root
    for (part in parts) {
      current = current.findFile(part)?.takeIf { it.isDirectory }
        ?: current.createDirectory(part)
        ?: throw IllegalStateException("Unable to create directory: $part")
    }
    return current
  }

  private fun findFile(root: DocumentFile, path: String): DocumentFile? {
    var current: DocumentFile = root
    for (part in safeParts(path)) current = current.findFile(part) ?: return null
    return current
  }

  private fun writeFile(root: DocumentFile, path: String, data: List<Int>) {
    val parts = safeParts(path)
    val parent = ensureDirectory(root, parts.dropLast(1))
    val name = parts.last()
    val file = parent.findFile(name)?.takeIf { it.isFile }
      ?: parent.createFile("application/octet-stream", name)
      ?: throw IllegalStateException("Unable to create file: $path")
    writeBytes(file, data)
  }

  private fun writeBytes(file: DocumentFile, data: List<Int>) {
    activity.contentResolver.openOutputStream(file.uri, "wt")!!.use { output ->
      output.write(ByteArray(data.size) { data[it].toByte() })
    }
  }

  private fun writeBytes(file: DocumentFile, data: ByteArray) {
    activity.contentResolver.openOutputStream(file.uri, "wt")!!.use { it.write(data) }
  }

  private fun writeNewFiles(root: DocumentFile, files: List<SourceFileArg>) {
    if (files.size > MAX_SOURCE_FILES) throw IllegalArgumentException("Skin source contains too many files")
    val directories = mutableMapOf("" to root)
    val paths = mutableSetOf<String>()
    var totalBytes = 0L
    for (file in files) {
      val parts = safeParts(file.path)
      if (!paths.add(file.path)) throw IllegalArgumentException("Skin source contains duplicate paths")
      val data = Base64.decode(file.data, Base64.DEFAULT)
      totalBytes += data.size
      if (totalBytes > MAX_SOURCE_BYTES) throw IllegalArgumentException("Skin source exceeds 256 MB")
      var parent = root
      var parentPath = ""
      for (part in parts.dropLast(1)) {
        parentPath = if (parentPath.isEmpty()) part else "$parentPath/$part"
        parent = directories[parentPath]
          ?: parent.createDirectory(part)?.also { directories[parentPath] = it }
          ?: throw IllegalStateException("Unable to create directory: $part")
      }
      val target = parent.createFile("application/octet-stream", parts.last())
        ?: throw IllegalStateException("Unable to create file: ${file.path}")
      writeBytes(target, data)
    }
  }

  private fun readFiles(root: DocumentFile, path: String, output: MutableList<Map<String, Any>>) {
    for (entry in root.listFiles()) {
      val name = entry.name ?: continue
      val relative = if (path.isEmpty()) name else "$path/$name"
      if (entry.isDirectory) {
        readFiles(entry, relative, output)
      } else if (entry.isFile && name !in setOf(SOURCE_MARKER, ".keyskin-files.json", ".DS_Store")) {
        val bytes = activity.contentResolver.openInputStream(entry.uri)!!.use { it.readBytes() }
        output.add(mapOf("path" to relative, "data" to bytes.map { it.toInt() and 0xff }))
      }
    }
  }

  private fun sourceArchive(root: DocumentFile): String {
    val archivePaths = mutableSetOf<String>()
    var totalBytes = 0L
    val output = ByteArrayOutputStream()
    ZipOutputStream(output).use { zip ->
      zip.setLevel(Deflater.BEST_SPEED)
      fun add(directory: DocumentFile, path: String) {
        for (entry in directory.listFiles()) {
          val name = entry.name ?: continue
          val relative = if (path.isEmpty()) name else "$path/$name"
          if (entry.isDirectory) {
            add(entry, relative)
          } else if (entry.isFile && name !in setOf(SOURCE_MARKER, ".keyskin-files.json", ".DS_Store")) {
            safeParts(relative)
            if (!archivePaths.add(relative)) throw IllegalArgumentException("Skin source contains duplicate paths")
            if (archivePaths.size > MAX_SOURCE_FILES) throw IllegalArgumentException("Skin source contains too many files")
            val bytes = activity.contentResolver.openInputStream(entry.uri)!!.use { it.readBytes() }
            totalBytes += bytes.size
            if (totalBytes > MAX_SOURCE_BYTES) throw IllegalArgumentException("Skin source exceeds 256 MB")
            zip.putNextEntry(ZipEntry(relative))
            zip.write(bytes)
            zip.closeEntry()
          }
        }
      }
      add(root, "")
    }
    if (archivePaths.isEmpty()) throw IllegalArgumentException("Skin source directory is empty")
    if (output.size() > MAX_ARCHIVE_BYTES) throw IllegalArgumentException("Skin source archive exceeds 64 MB")
    return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
  }

  private fun skinDocument(path: String): DocumentFile {
    val uri = Uri.parse(path)
    require(DocumentsContract.isDocumentUri(activity, uri)) { "请选择本地皮肤文件" }
    return DocumentFile.fromSingleUri(activity, uri) ?: throw IllegalArgumentException("皮肤文件不可用")
  }

  private fun documentExists(uri: Uri): Boolean = activity.contentResolver
    .query(uri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
    ?.use { it.moveToFirst() } ?: throw IllegalStateException("无法检查文件是否存在")

  private fun sourceMarker(folder: DocumentFile): DocumentFile? {
    val marker = folder.findFile(SOURCE_MARKER)?.takeIf { it.isFile } ?: return null
    val expected = SOURCE_MARKER_CONTENT.toByteArray()
    return activity.contentResolver.openInputStream(marker.uri)!!.use { input ->
      if (expected.all { input.read() == it.toInt() } && input.read() == -1) marker else null
    }
  }

  private fun managedSourceForDeletion(path: String): DocumentFile? {
    val uri = Uri.parse(path)
    require(DocumentsContract.isTreeUri(uri) && DocumentsContract.isDocumentUri(activity, uri) &&
      DocumentsContract.getTreeDocumentId(uri) != DocumentsContract.getDocumentId(uri)) { "不是有效的源码目录路径" }
    if (!documentExists(uri)) return null
    return directory(path).takeIf { sourceMarker(it) != null }
  }

  @Command
  fun deleteSkinFile(invoke: Invoke) {
    runSourceIO(invoke, "无法删除皮肤文件") {
      val args = invoke.parseArgs(DeleteSkinArgs::class.java)
      val file = skinDocument(args.uri)
      val workspace = args.source?.let { managedSourceForDeletion(it) }
      if (documentExists(file.uri)) {
        require(file.isFile && file.name?.substringAfterLast('.', "")?.lowercase() in
          setOf("bdi", "bds", "bda", "ssf", "mssf", "sxi")) { "只可删除可访问的本地皮肤文件" }
        check(DocumentsContract.deleteDocument(activity.contentResolver, file.uri)) { "提供程序不允许删除该文件" }
      }
      if (workspace != null) check(workspace.delete()) { "无法删除源码目录：${workspace.name}" }
      null
    }
  }

  @Command
  fun skinFileStamp(invoke: Invoke) {
    runSourceIO(invoke, "无法读取皮肤文件信息") {
      val file = skinDocument(invoke.parseArgs(WorkspaceArgs::class.java).uri)
      check(file.isFile) { "皮肤文件不可用" }
      listOf(file.length(), file.lastModified())
    }
  }

  private fun pruneSourceWorkspaces(root: DocumentFile, current: DocumentFile, limit: Int) {
    val older = root.listFiles().filter { it.uri != current.uri && it.isDirectory }.mapNotNull { folder ->
      folder.findFile(SOURCE_MARKER)?.takeIf { it.isFile }?.let { folder to it.lastModified() }
    }.sortedWith(compareBy({ it.second }, { it.first.name }))
    older.take((older.size + 1 - limit).coerceAtLeast(0)).forEach { (folder, _) ->
      check(folder.delete()) { "无法删除旧源码目录：${folder.name}" }
    }
  }

  @Command
  fun createSourceWorkspace(invoke: Invoke) {
    runSourceIO(invoke, "Unable to create source workspace") {
      val args = invoke.parseArgs(CreateWorkspaceArgs::class.java)
      val root = directory(args.uri)
      val names = root.listFiles().mapNotNull { it.name }.toSet()
      var name = args.name
      var suffix = 2
      while (name in names) name = "${args.name} (${suffix++})"
      val workspace = root.createDirectory(name)
        ?: throw IllegalStateException("Unable to create source workspace")
      try {
        writeNewFiles(workspace, args.files)
        val marker = workspace.createFile("application/octet-stream", SOURCE_MARKER)
          ?: throw IllegalStateException("无法标记源码目录")
        writeBytes(marker, SOURCE_MARKER_CONTENT.toByteArray())
        args.sourceLimit?.let { limit -> pruneSourceWorkspaces(root, workspace, limit) }
        workspace.uri.toString()
      } catch (error: Exception) {
        workspace.delete()
        throw error
      }
    }
  }

  @Command
  fun readSourceWorkspace(invoke: Invoke) {
    runSourceIO(invoke, "Unable to read source workspace") {
      val args = invoke.parseArgs(WorkspaceArgs::class.java)
      val output = mutableListOf<Map<String, Any>>()
      readFiles(directory(args.uri), "", output)
      output
    }
  }

  @Command
  fun readSourceWorkspaceArchive(invoke: Invoke) {
    runSourceIO(invoke, "Unable to read source workspace") {
      val args = invoke.parseArgs(WorkspaceArgs::class.java)
      val workspace = directory(args.uri)
      mapOf("name" to workspace.name.orEmpty(), "archive" to sourceArchive(workspace)).also {
        runCatching { sourceMarker(workspace)?.let { marker -> writeBytes(marker, SOURCE_MARKER_CONTENT.toByteArray()) } }
      }
    }
  }

  @Command
  fun applySourceChanges(invoke: Invoke) {
    runSourceIO(invoke, "Unable to save source changes") {
      val args = invoke.parseArgs(ApplyChangesArgs::class.java)
      val root = directory(args.uri)
      args.changes.forEach { change ->
        if (change.data == null) findFile(root, change.path)?.delete()
        else writeFile(root, change.path, change.data!!)
      }
      null
    }
  }
}
