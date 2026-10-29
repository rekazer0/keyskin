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
import androidx.annotation.Keep
import androidx.core.content.FileProvider
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
    private const val MAX_SOURCE_FILES = 4096
    private const val MAX_SOURCE_BYTES = 256L * 1024 * 1024
  }

  private var sourceObserver: ContentObserver? = null
  private var sourcePoll: ScheduledFuture<*>? = null
  private val sourceExecutor = Executors.newSingleThreadExecutor()
  private val sourcePollExecutor = Executors.newSingleThreadScheduledExecutor()

  @Command
  fun chooseProjectTemplate(invoke: Invoke) {
    val names = arrayOf(
      "百度官方 Android BDA 默认皮肤\n官方 1080p 横竖屏样式与资源",
      "百度官方 Android BDS 默认皮肤\n官方旧格式 480px 横竖屏布局",
      "OPPO皮肤加下滑功能\n互联网整理 BDS 皮肤",
      "OPPO默认双色皮肤\n互联网整理 BDS 皮肤",
      "IQOO提取圆角黑色\n互联网整理 BDS 皮肤",
      "小米默认皮肤(统一颜色键盘版3)_适配圆角模糊\n互联网整理 BDS 皮肤",
      "华为提取上滑符号1080\n互联网整理 BDS 皮肤",
      "手心输入法-鸿蒙内置皮肤\n互联网整理 SXI 皮肤",
    )
    val ids = arrayOf(
      "default-android",
      "official-android-bds",
      "oppo-swipe-down",
      "oppo-dual-color",
      "iqoo-rounded-black",
      "xiaomi-unified-rounded-blur",
      "huawei-swipe-symbols-1080",
      "palm-harmony",
    )
    var selected = 0
    AlertDialog.Builder(activity)
      .setTitle("新建皮肤")
      .setSingleChoiceItems(names, selected) { _, index -> selected = index }
      .setNegativeButton("取消") { _, _ ->
        invoke.reject("project template selection cancelled")
      }
      .setPositiveButton("创建皮肤") { _, _ ->
        invoke.resolveObject(ids[selected])
      }
      .setOnCancelListener {
        invoke.reject("project template selection cancelled")
      }
      .show()
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
      sourceObserver?.let { activity.contentResolver.unregisterContentObserver(it) }
      sourcePoll?.cancel(false)
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

  @Command
  fun stopSourceObserver(invoke: Invoke) {
    sourceObserver?.let { activity.contentResolver.unregisterContentObserver(it) }
    sourceObserver = null
    sourcePoll?.cancel(false)
    sourcePoll = null
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
      } else if (entry.isFile && name !in setOf(".keyskin-source", ".keyskin-files.json", ".DS_Store")) {
        val bytes = activity.contentResolver.openInputStream(entry.uri)!!.use { it.readBytes() }
        output.add(mapOf("path" to relative, "data" to bytes.map { it.toInt() and 0xff }))
      }
    }
  }

  private fun sourceArchive(root: DocumentFile): String {
    val prefix = root.name?.lowercase()?.takeIf { it == "dark" || it == "light" }?.let { "$it/" } ?: ""
    val archivePaths = mutableSetOf<String>()
    var fileCount = 0
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
          } else if (entry.isFile && name !in setOf(".keyskin-source", ".keyskin-files.json", ".DS_Store")) {
            safeParts(relative)
            fileCount += 1
            if (fileCount > MAX_SOURCE_FILES) throw IllegalArgumentException("Skin source contains too many files")
            val bytes = activity.contentResolver.openInputStream(entry.uri)!!.use { it.readBytes() }
            totalBytes += bytes.size
            if (totalBytes > MAX_SOURCE_BYTES) throw IllegalArgumentException("Skin source exceeds 256 MB")
            val archivePath = if (
              prefix.isNotEmpty()
              && relative != "Info.txt"
              && relative != "demo.png"
              && !relative.startsWith(prefix)
            ) "$prefix$relative" else relative
            if (!archivePaths.add(archivePath)) throw IllegalArgumentException("Skin source contains duplicate paths")
            zip.putNextEntry(ZipEntry(archivePath))
            zip.write(bytes)
            zip.closeEntry()
          }
        }
      }
      add(root, "")
    }
    if (fileCount == 0) throw IllegalArgumentException("Skin source directory is empty")
    if (output.size() > MAX_ARCHIVE_BYTES) throw IllegalArgumentException("Skin source archive exceeds 64 MB")
    return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
  }

  @Command
  fun createSourceWorkspace(invoke: Invoke) {
    runSourceIO(invoke, "Unable to create source workspace") {
      val args = invoke.parseArgs(CreateWorkspaceArgs::class.java)
      val root = directory(args.uri)
      val stem = args.name.substringAfterLast('/').substringBeforeLast('.').replace(Regex("[^A-Za-z0-9_-]"), "-").take(48).ifEmpty { "skin" }
      val workspace = root.createDirectory("${System.currentTimeMillis()}-$stem")
        ?: throw IllegalStateException("Unable to create source workspace")
      writeNewFiles(workspace, args.files)
      workspace.uri.toString()
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
      sourceArchive(directory(args.uri))
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
