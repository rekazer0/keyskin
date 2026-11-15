use serde::{de::DeserializeOwned, Deserialize};
use std::borrow::Cow;
use tauri::{http::HeaderMap, ipc::InvokeBody};

pub fn arguments<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, String> {
    let metadata = headers
        .get("x-keyskin-args")
        .ok_or("缺少文件传输参数")?
        .to_str()
        .map_err(|_| "无效的文件传输参数")?;
    serde_json::from_str(metadata).map_err(|e| format!("无效的文件传输参数：{e}"))
}

pub fn bytes(body: &InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    match body {
        InvokeBody::Raw(data) => Ok(Cow::Borrowed(data)),
        // Tauri 的 postMessage 回退通道会把 Uint8Array 序列化为 JSON 字节数组。
        InvokeBody::Json(data) => Vec::<u8>::deserialize(data)
            .map(Cow::Owned)
            .map_err(|_| "文件传输需要二进制数据".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_payload_preserves_all_bytes_without_json_conversion() {
        let body = InvokeBody::Raw((0..=255).collect());
        let decoded = bytes(&body).unwrap();
        assert!(matches!(decoded, Cow::Borrowed(_)));
        assert_eq!(decoded.as_ref(), (0..=255).collect::<Vec<u8>>());
    }

    #[test]
    fn post_message_fallback_preserves_all_bytes() {
        let expected = (0..=255).collect::<Vec<u8>>();
        let body = InvokeBody::Json(serde_json::json!(expected));
        assert_eq!(bytes(&body).unwrap().into_owned(), expected);
        let empty = InvokeBody::Json(serde_json::json!([]));
        assert!(bytes(&empty).unwrap().is_empty());
    }

    #[test]
    fn post_message_fallback_rejects_invalid_bytes() {
        for invalid in [
            serde_json::json!([0, -1]),
            serde_json::json!([0, 256]),
            serde_json::json!([0, 1.5]),
            serde_json::json!([0, "1"]),
            serde_json::json!([0, true]),
            serde_json::json!([0, null]),
            serde_json::json!({"0": 1}),
            serde_json::json!("AA=="),
            serde_json::json!(null),
        ] {
            assert!(bytes(&InvokeBody::Json(invalid)).is_err());
        }
    }

    #[test]
    fn headers_decode_unicode_and_reject_missing_or_invalid_arguments() {
        #[derive(serde::Deserialize)]
        struct Arguments {
            path: String,
            progress: tauri::ipc::JavaScriptChannelId,
        }
        let mut headers = HeaderMap::new();
        assert!(arguments::<Arguments>(&headers).is_err());
        headers.insert(
            "x-keyskin-args",
            r#"{"path":"/tmp/\u76ae\u80a4.bds","progress":"__CHANNEL__:1"}"#
                .parse()
                .unwrap(),
        );
        let args: Arguments = arguments(&headers).unwrap();
        assert_eq!(args.path, "/tmp/皮肤.bds");
        let _ = args.progress;
        for value in [
            "invalid",
            r#"{"path":false}"#,
            r#"{"path":"x","progress":"invalid"}"#,
        ] {
            headers.insert("x-keyskin-args", value.parse().unwrap());
            assert!(arguments::<Arguments>(&headers).is_err());
        }
    }
}
