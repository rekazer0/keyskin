use serde::de::DeserializeOwned;
use tauri::{http::HeaderMap, ipc::InvokeBody};

pub fn arguments<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, String> {
    let metadata = headers
        .get("x-keyskin-args")
        .ok_or("缺少文件传输参数")?
        .to_str()
        .map_err(|_| "无效的文件传输参数")?;
    serde_json::from_str(metadata).map_err(|e| format!("无效的文件传输参数：{e}"))
}

pub fn bytes(body: &InvokeBody) -> Result<&[u8], String> {
    match body {
        InvokeBody::Raw(data) => Ok(data),
        _ => Err("文件传输需要二进制数据".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_payload_preserves_all_bytes_without_json_conversion() {
        let body = InvokeBody::Raw((0..=255).collect());
        assert_eq!(bytes(&body).unwrap(), (0..=255).collect::<Vec<u8>>());
        assert!(bytes(&InvokeBody::Json(serde_json::json!([1, 2]))).is_err());
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
