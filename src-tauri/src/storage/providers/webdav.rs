use super::{
    CreateFileRequest, CreateFolderRequest, StorageFile, StorageProvider, StorageProviderType,
    UpdateFileRequest,
};
use crate::storage::{StorageError, StorageResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri_plugin_http::reqwest;

// Static HTTP client for connection pooling and reuse
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Get or create the shared HTTP client
fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(3))
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Monark-App/1.0")
            .build()
            .expect("Failed to create HTTP client")
    })
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WebDavConfig {
    pub server_url: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub base_path: String,
}

#[derive(Debug, Clone)]
pub struct WebDavProvider {
    config: WebDavConfig,
}

// WebDAV XML response deserialization structs

#[derive(Debug, Deserialize)]
struct Multistatus {
    #[serde(rename = "response", default)]
    responses: Vec<WebDavResponse>,
}

#[derive(Debug, Deserialize)]
struct WebDavResponse {
    href: String,
    #[serde(rename = "propstat", default)]
    propstats: Vec<WebDavPropstat>,
}

#[derive(Debug, Deserialize)]
struct WebDavPropstat {
    prop: WebDavProp,
    status: String,
}

#[derive(Debug, Deserialize, Default)]
struct WebDavProp {
    #[serde(rename = "displayname", default)]
    displayname: Option<String>,
    #[serde(rename = "getcontentlength", default)]
    getcontentlength: Option<String>,
    #[serde(rename = "getlastmodified", default)]
    getlastmodified: Option<String>,
    #[serde(rename = "creationdate", default)]
    creationdate: Option<String>,
    #[serde(rename = "resourcetype", default)]
    resourcetype: WebDavResourceType,
    #[serde(rename = "getcontenttype", default)]
    getcontenttype: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct WebDavResourceType {
    #[serde(rename = "collection", default)]
    collection: Option<()>,
}

/// Strip XML namespace prefixes from element names so quick-xml can
/// deserialize without worrying about `d:`, `D:`, `DAV:`, etc.
fn strip_namespace_prefixes(xml: &str) -> String {
    // Replace opening tags like <d:propfind>, <D:multistatus>, etc.
    // and closing tags like </d:propfind> with their local-name equivalents.
    let mut result = String::with_capacity(xml.len());
    let bytes = xml.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'<' {
            // Check if this is a closing tag
            let is_closing = i + 1 < len && bytes[i + 1] == b'/';
            let is_declaration = i + 1 < len && bytes[i + 1] == b'?';
            let is_comment_start = i + 2 < len && bytes[i + 1] == b'!' && bytes[i + 2] == b'-';

            if is_declaration {
                // Skip <?xml ... ?> declarations
                if let Some(end) = xml[i..].find("?>") {
                    result.push_str(&xml[i..i + end + 2]);
                    i += end + 2;
                } else {
                    result.push(bytes[i] as char);
                    i += 1;
                }
            } else if is_comment_start {
                // Skip <!-- ... --> comments
                if let Some(end) = xml[i..].find("-->") {
                    result.push_str(&xml[i..i + end + 3]);
                    i += end + 3;
                } else {
                    result.push(bytes[i] as char);
                    i += 1;
                }
            } else {
                // Write the < (and / if closing)
                result.push('<');
                let mut pos = i + 1;
                if is_closing {
                    result.push('/');
                    pos += 1;
                }

                // Find the tag name, skipping namespace prefix
                let tag_start = pos;
                while pos < len
                    && bytes[pos] != b'>'
                    && bytes[pos] != b' '
                    && bytes[pos] != b'\t'
                    && bytes[pos] != b'\n'
                    && bytes[pos] != b'\r'
                    && bytes[pos] != b'/'
                {
                    pos += 1;
                }

                // Check if there's a colon (namespace prefix) in the tag name
                let tag_str = &xml[tag_start..pos];
                if let Some(colon_pos) = tag_str.find(':') {
                    // Skip the prefix, write only the local name
                    result.push_str(&tag_str[colon_pos + 1..]);
                } else {
                    result.push_str(tag_str);
                }

                // Write the rest of the tag until >
                while pos < len && bytes[pos] != b'>' {
                    result.push(bytes[pos] as char);
                    pos += 1;
                }
                if pos < len {
                    result.push('>'); // the >
                    pos += 1;
                }
                i = pos;
            }
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

impl std::fmt::Debug for WebDavConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebDavConfig")
            .field("server_url", &self.server_url)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("base_path", &self.base_path)
            .finish()
    }
}

/// Check that a relative path extracted from a server-provided href does not
/// contain `..` traversal components (M1 path-traversal guard).
fn is_safe_relative_path(path: &str) -> bool {
    !path.split('/').any(|component| component == "..")
}

impl WebDavProvider {
    pub fn new(config: WebDavConfig) -> Self {
        Self { config }
    }

    pub fn get_config(&self) -> &WebDavConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: WebDavConfig) {
        self.config = config;
    }

    /// Build the Basic Authorization header value
    fn auth_header(&self) -> String {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        format!(
            "Basic {}",
            STANDARD.encode(format!("{}:{}", self.config.username, self.config.password))
        )
    }

    /// Resolve a relative file_id to the full WebDAV URL.
    ///
    /// If `base_path` is set, it is prepended between `server_url` and `file_id`.
    fn resolve_url(&self, file_id: &str) -> String {
        let server = self.config.server_url.trim_end_matches('/');
        if self.config.base_path.is_empty() {
            format!("{}/{}", server, file_id.trim_start_matches('/'))
        } else {
            format!(
                "{}/{}/{}",
                server,
                self.config.base_path.trim_matches('/'),
                file_id.trim_start_matches('/')
            )
        }
    }

    /// Get the URL for the vault root (base_path or server_url)
    fn base_url(&self) -> String {
        let server = self.config.server_url.trim_end_matches('/');
        if self.config.base_path.is_empty() {
            server.to_string()
        } else {
            format!("{}/{}/", server, self.config.base_path.trim_matches('/'))
        }
    }

    /// Extract the relative file path from a full WebDAV href.
    ///
    /// The href returned by the server is an absolute path (e.g.
    /// `/remote.php/dav/files/user/Monark/myvault.monark`). We need to strip
    /// the server path prefix and optional base_path to get the relative id.
    fn extract_relative_path(&self, href: &str) -> String {
        // Build the prefix to strip: server_path + optional base_path
        // server_url may be like https://host/remote.php/dav/files/user
        // href is like /remote.php/dav/files/user/Monark/vault.monark
        // We need to strip everything up to and including the base_path portion.

        // Extract the path portion from server_url
        if let Ok(server_parsed) = url::Url::parse(&self.config.server_url) {
            let server_path = server_parsed.path().trim_end_matches('/');

            // The href starts with the server's path. Strip it.
            let after_server = if href.starts_with(server_path) {
                href[server_path.len()..].trim_start_matches('/')
            } else {
                href.trim_start_matches('/')
            };

            // Now strip the base_path prefix if present
            if self.config.base_path.is_empty() {
                after_server.to_string()
            } else {
                let bp = self.config.base_path.trim_matches('/');
                if after_server.starts_with(bp) {
                    let rest = after_server[bp.len()..].trim_start_matches('/');
                    rest.to_string()
                } else {
                    after_server.to_string()
                }
            }
        } else {
            // Fallback: just strip leading slash
            href.trim_start_matches('/').to_string()
        }
    }

    /// Convert a WebDAV response element into a StorageFile
    fn webdav_response_to_storage_file(
        &self,
        response: &WebDavResponse,
        _is_self: bool,
    ) -> Option<StorageFile> {
        // Get the first propstat with 200 status
        let propstat = response
            .propstats
            .iter()
            .find(|ps| ps.status.contains("200"))?;

        let prop = &propstat.prop;
        let href = &response.href;

        // Extract relative path as the file id
        let relative_path = self.extract_relative_path(href);

        // M1: Reject server-provided hrefs that contain path traversal components
        if !is_safe_relative_path(&relative_path) {
            return None;
        }

        // Skip the collection itself when listing (but keep it for get_file_info)
        // We use is_self flag for this

        // Determine display name
        let name = prop
            .displayname
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| {
                // Extract name from href (last non-empty segment)
                href.trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .to_string()
            });

        // Determine if this is a folder
        let is_folder = prop.resourcetype.collection.is_some();

        // Parse size
        let size = if is_folder {
            None
        } else {
            prop.getcontentlength
                .as_ref()
                .and_then(|s| s.parse::<u64>().ok())
        };

        // Parse modified_at (RFC 2822)
        let modified_at = prop
            .getlastmodified
            .as_ref()
            .and_then(|s| DateTime::parse_from_rfc2822(s).ok())
            .map(|dt| dt.with_timezone(&Utc));

        // Parse created_at (ISO 8601 / RFC 3339)
        let created_at = prop
            .creationdate
            .as_ref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));

        // Parent id
        let parent_id = if relative_path.is_empty() {
            None
        } else {
            let path = relative_path.trim_end_matches('/');
            match path.rfind('/') {
                Some(pos) => {
                    let parent = &path[..pos];
                    if parent.is_empty() {
                        None
                    } else {
                        Some(parent.to_string())
                    }
                }
                None => Some(String::new()),
            }
        };

        let id = if relative_path.is_empty() {
            String::new()
        } else {
            relative_path.trim_end_matches('/').to_string()
        };

        // Build metadata
        let mut metadata = HashMap::new();
        if let Some(content_type) = &prop.getcontenttype {
            metadata.insert("content_type".to_string(), content_type.clone());
        }

        Some(StorageFile {
            id,
            name,
            path: relative_path.clone(),
            size,
            created_at,
            modified_at,
            is_folder,
            mime_type: prop.getcontenttype.clone(),
            parent_id,
            metadata,
        })
    }

    /// Execute a PROPFIND request and parse the multistatus response
    async fn propfind(&self, url: &str, depth: &str) -> StorageResult<Vec<WebDavResponse>> {
        let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:creationdate/>
    <D:resourcetype/>
    <D:getcontenttype/>
  </D:prop>
</D:propfind>"#;

        let client = get_http_client();
        let response = client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url)
            .header("Authorization", self.auth_header())
            .header("Depth", depth)
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(propfind_body)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("PROPFIND request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        // Accept 207 Multi-Status and also 200 (some servers return 200)
        if !status.is_success() && status.as_u16() != 207 {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::network(format!(
                "PROPFIND failed ({}): {}",
                status, error_text
            )));
        }

        let body = response.text().await.map_err(|e| {
            StorageError::network(format!("Failed to read PROPFIND response: {}", e))
        })?;

        // Strip namespace prefixes for reliable deserialization
        let stripped = strip_namespace_prefixes(&body);

        let multistatus: Multistatus = quick_xml::de::from_str(&stripped).map_err(|e| {
            StorageError::operation_failed(format!(
                "Failed to parse WebDAV multistatus response: {}",
                e
            ))
        })?;

        Ok(multistatus.responses)
    }

    /// Recursive file listing for search operations
    async fn search_recursive(
        &self,
        folder_url: &str,
        query: &str,
        results: &mut Vec<StorageFile>,
    ) -> StorageResult<()> {
        let responses = self.propfind(folder_url, "1").await?;

        for response in &responses {
            let href = response.href.clone();

            // Skip the folder itself (first entry)
            let relative_path = self.extract_relative_path(&href);
            if relative_path.is_empty()
                || href.trim_end_matches('/') == folder_url.trim_end_matches('/')
                || !is_safe_relative_path(&relative_path)
            {
                continue;
            }

            if let Some(storage_file) = self.webdav_response_to_storage_file(response, false) {
                if storage_file
                    .name
                    .to_lowercase()
                    .contains(&query.to_lowercase())
                {
                    results.push(storage_file);
                }

                // Recurse into subdirectories
                if response
                    .propstats
                    .iter()
                    .any(|ps| ps.prop.resourcetype.collection.is_some())
                {
                    let sub_url = if href.starts_with("http") {
                        href.clone()
                    } else {
                        // Build full URL from href
                        let server = self.config.server_url.trim_end_matches('/');
                        if href.starts_with('/') {
                            // href is an absolute path — use server host
                            if let Ok(mut base) = url::Url::parse(&self.config.server_url) {
                                base.set_path(&href);
                                base.to_string()
                            } else {
                                format!("{}{}", server, href)
                            }
                        } else {
                            format!("{}/{}", folder_url.trim_end_matches('/'), href)
                        }
                    };
                    Box::pin(self.search_recursive(&sub_url, query, results)).await?;
                }
            }
        }

        Ok(())
    }
}

#[async_trait]
impl StorageProvider for WebDavProvider {
    fn provider_type(&self) -> StorageProviderType {
        StorageProviderType::WebDav
    }

    async fn authenticate(&mut self) -> StorageResult<()> {
        println!("[WebDAV] Authenticating to {}", self.config.server_url);

        let url = self.base_url();
        let client = get_http_client();
        let response = client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header("Authorization", self.auth_header())
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(
                r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
  </D:prop>
</D:propfind>"#,
            )
            .send()
            .await
            .map_err(|e| StorageError::network(format!("Authentication request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): {}",
                status, error_text
            )));
        }

        println!("[WebDAV] Authentication successful");
        Ok(())
    }

    async fn is_authenticated(&self) -> bool {
        // Basic auth is stateless — credentials are always in config
        !self.config.username.is_empty()
    }

    async fn list_files(&mut self, folder_id: Option<String>) -> StorageResult<Vec<StorageFile>> {
        let url = match folder_id {
            Some(ref id) => {
                if id.is_empty() {
                    self.base_url()
                } else {
                    self.resolve_url(id)
                }
            }
            None => self.base_url(),
        };

        println!("[WebDAV] Listing files at {}", url);

        let responses = self.propfind(&url, "1").await?;

        let mut files = Vec::new();
        let folder_url_normalized = url.trim_end_matches('/');

        for response in &responses {
            // Skip the folder itself (first response)
            let href_normalized = response.href.trim_end_matches('/');
            if href_normalized == folder_url_normalized {
                continue;
            }

            if let Some(file) = self.webdav_response_to_storage_file(response, false) {
                files.push(file);
            }
        }

        Ok(files)
    }

    async fn create_file(&mut self, request: CreateFileRequest) -> StorageResult<StorageFile> {
        let file_id = if let Some(ref parent_id) = request.parent_id {
            if parent_id.is_empty() {
                request.name.clone()
            } else {
                format!("{}/{}", parent_id, request.name)
            }
        } else {
            request.name.clone()
        };

        let url = self.resolve_url(&file_id);
        println!("[WebDAV] Creating file at {}", url);

        let client = get_http_client();
        let response = client
            .request(reqwest::Method::from_bytes(b"PUT").unwrap(), &url)
            .header("Authorization", self.auth_header())
            .header(
                "Content-Type",
                request
                    .mime_type
                    .as_deref()
                    .unwrap_or("application/octet-stream"),
            )
            .body(request.content)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("PUT request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        if !status.is_success() && status.as_u16() != 201 && status.as_u16() != 204 {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to create file ({}): {}",
                status, error_text
            )));
        }

        // Return a StorageFile representing the newly created file
        Ok(StorageFile {
            id: file_id.clone(),
            name: request.name,
            path: file_id,
            size: None,
            created_at: Some(Utc::now()),
            modified_at: Some(Utc::now()),
            is_folder: false,
            mime_type: request.mime_type,
            parent_id: request.parent_id,
            metadata: HashMap::new(),
        })
    }

    async fn read_file(&mut self, file_id: String) -> StorageResult<Vec<u8>> {
        let url = self.resolve_url(&file_id);
        println!("[WebDAV] Reading file at {}", url);

        let client = get_http_client();
        let response = client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| StorageError::network(format!("GET request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(StorageError::file_not_found(file_id));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to read file ({}): {}",
                status, error_text
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| StorageError::network(format!("Failed to read file content: {}", e)))?;

        Ok(bytes.to_vec())
    }

    async fn delete_file(&mut self, file_id: String) -> StorageResult<()> {
        let url = self.resolve_url(&file_id);
        println!("[WebDAV] Deleting file at {}", url);

        let client = get_http_client();
        let response = client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| StorageError::network(format!("DELETE request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(StorageError::file_not_found(file_id));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to delete file ({}): {}",
                status, error_text
            )));
        }

        Ok(())
    }

    async fn update_file(&mut self, request: UpdateFileRequest) -> StorageResult<StorageFile> {
        let url = self.resolve_url(&request.id);
        println!("[WebDAV] Updating file at {}", url);

        let client = get_http_client();
        let response = client
            .request(reqwest::Method::from_bytes(b"PUT").unwrap(), &url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/octet-stream")
            .body(request.content)
            .send()
            .await
            .map_err(|e| StorageError::network(format!("PUT request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(StorageError::file_not_found(request.id));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        if !status.is_success() && status.as_u16() != 204 {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to update file ({}): {}",
                status, error_text
            )));
        }

        // Return the updated file info via PROPFIND
        self.get_file_info(request.id).await
    }

    async fn create_folder(&mut self, request: CreateFolderRequest) -> StorageResult<StorageFile> {
        let folder_id = if let Some(ref parent_id) = request.parent_id {
            if parent_id.is_empty() {
                request.name.clone()
            } else {
                format!("{}/{}", parent_id, request.name)
            }
        } else {
            request.name.clone()
        };

        let url = self.resolve_url(&folder_id);
        println!("[WebDAV] Creating folder at {}", url);

        let client = get_http_client();
        let response = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| StorageError::network(format!("MKCOL request failed: {}", e)))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(StorageError::authentication(format!(
                "WebDAV authentication failed ({}): check your credentials",
                status
            )));
        }

        // 201 Created, 405 Method Not Allowed (already exists) are both acceptable
        if !status.is_success() && status.as_u16() != 405 {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(StorageError::operation_failed(format!(
                "Failed to create folder ({}): {}",
                status, error_text
            )));
        }

        let path = format!("/{}/", folder_id.trim_matches('/'));

        Ok(StorageFile {
            id: folder_id.clone(),
            name: request.name,
            path,
            size: None,
            created_at: Some(Utc::now()),
            modified_at: Some(Utc::now()),
            is_folder: true,
            mime_type: Some("httpd/unix-directory".to_string()),
            parent_id: request.parent_id,
            metadata: HashMap::new(),
        })
    }

    async fn delete_folder(&mut self, folder_id: String) -> StorageResult<()> {
        self.delete_file(folder_id).await
    }

    async fn get_file_info(&mut self, file_id: String) -> StorageResult<StorageFile> {
        let url = self.resolve_url(&file_id);
        println!("[WebDAV] Getting file info at {}", url);

        let responses = self.propfind(&url, "0").await?;

        let response = responses.first().ok_or_else(|| {
            StorageError::file_not_found(format!("No response for file: {}", file_id))
        })?;

        self.webdav_response_to_storage_file(response, true)
            .ok_or_else(|| {
                StorageError::file_not_found(format!("Could not parse file info for: {}", file_id))
            })
    }

    async fn search_files(&mut self, query: String) -> StorageResult<Vec<StorageFile>> {
        println!("[WebDAV] Searching files for '{}'", query);

        let base_url = self.base_url();
        let mut results = Vec::new();
        self.search_recursive(&base_url, &query, &mut results)
            .await?;

        Ok(results)
    }

    async fn list_vaults(&mut self) -> StorageResult<Vec<StorageFile>> {
        println!("[WebDAV] Listing vaults");

        let files = self.list_files(None).await?;

        Ok(files
            .into_iter()
            .filter(|f| f.name.ends_with(".monark"))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_namespace_prefixes() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/user/Monark/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Monark</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getcontentlength>0</d:getcontentlength>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

        let stripped = strip_namespace_prefixes(xml);
        assert!(stripped.contains("<multistatus"));
        assert!(stripped.contains("<response>"));
        assert!(stripped.contains("<displayname>Monark</displayname>"));
        assert!(stripped.contains("<collection/>"));
        // No namespace prefixes should remain
        assert!(!stripped.contains("d:"));
        assert!(!stripped.contains("D:"));
    }

    #[test]
    fn test_strip_uppercase_namespace_prefixes() {
        let xml = r#"<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/test/</D:href>
  </D:response>
</D:multistatus>"#;

        let stripped = strip_namespace_prefixes(xml);
        assert!(stripped.contains("<multistatus"));
        assert!(stripped.contains("<response>"));
        assert!(!stripped.contains("D:"));
    }

    #[test]
    fn test_parse_multistatus() {
        let xml = r#"<?xml version="1.0"?>
<multistatus xmlns:d="DAV:">
  <response>
    <href>/remote.php/dav/files/user/Monark/vault.monark</href>
    <propstat>
      <prop>
        <displayname>vault.monark</displayname>
        <getcontentlength>1024</getcontentlength>
        <getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</getlastmodified>
        <creationdate>2024-01-01T00:00:00Z</creationdate>
        <getcontenttype>application/octet-stream</getcontenttype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>"#;

        let stripped = strip_namespace_prefixes(xml);
        let multistatus: Multistatus = quick_xml::de::from_str(&stripped).unwrap();
        assert_eq!(multistatus.responses.len(), 1);
        assert_eq!(
            multistatus.responses[0].href,
            "/remote.php/dav/files/user/Monark/vault.monark"
        );
        assert_eq!(
            multistatus.responses[0].propstats[0]
                .prop
                .displayname
                .as_deref(),
            Some("vault.monark")
        );
        assert!(multistatus.responses[0].propstats[0]
            .prop
            .resourcetype
            .collection
            .is_none());
    }

    #[test]
    fn test_parse_multistatus_with_folder() {
        let xml = r#"<?xml version="1.0"?>
<multistatus>
  <response>
    <href>/Monark/</href>
    <propstat>
      <prop>
        <displayname>Monark</displayname>
        <resourcetype><collection/></resourcetype>
        <getcontentlength>0</getcontentlength>
        <getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</getlastmodified>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/Monark/test.monark</href>
    <propstat>
      <prop>
        <displayname>test.monark</displayname>
        <getcontentlength>512</getcontentlength>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>"#;

        let multistatus: Multistatus = quick_xml::de::from_str(xml).unwrap();
        assert_eq!(multistatus.responses.len(), 2);

        // First response is the folder
        let folder = &multistatus.responses[0];
        assert!(folder.propstats[0].prop.resourcetype.collection.is_some());

        // Second response is the file
        let file = &multistatus.responses[1];
        assert!(file.propstats[0].prop.resourcetype.collection.is_none());
        assert_eq!(
            file.propstats[0].prop.getcontentlength.as_deref(),
            Some("512")
        );
    }

    #[test]
    fn test_resolve_url() {
        let provider = WebDavProvider::new(WebDavConfig {
            server_url: "https://cloud.example.com/remote.php/dav/files/user".to_string(),
            username: "user".to_string(),
            password: "pass".to_string(),
            base_path: "Monark".to_string(),
        });

        assert_eq!(
            provider.resolve_url("vault.monark"),
            "https://cloud.example.com/remote.php/dav/files/user/Monark/vault.monark"
        );
        assert_eq!(
            provider.resolve_url("subdir/vault.monark"),
            "https://cloud.example.com/remote.php/dav/files/user/Monark/subdir/vault.monark"
        );
    }

    #[test]
    fn test_resolve_url_no_base_path() {
        let provider = WebDavProvider::new(WebDavConfig {
            server_url: "https://cloud.example.com/webdav/".to_string(),
            username: "user".to_string(),
            password: "pass".to_string(),
            base_path: String::new(),
        });

        assert_eq!(
            provider.resolve_url("vault.monark"),
            "https://cloud.example.com/webdav/vault.monark"
        );
    }

    #[test]
    fn test_extract_relative_path() {
        let provider = WebDavProvider::new(WebDavConfig {
            server_url: "https://cloud.example.com/remote.php/dav/files/user".to_string(),
            username: "user".to_string(),
            password: "pass".to_string(),
            base_path: "Monark".to_string(),
        });

        assert_eq!(
            provider.extract_relative_path("/remote.php/dav/files/user/Monark/vault.monark"),
            "vault.monark"
        );
        assert_eq!(
            provider.extract_relative_path("/remote.php/dav/files/user/Monark/"),
            ""
        );
        assert_eq!(
            provider.extract_relative_path("/remote.php/dav/files/user/Monark/subdir/file.txt"),
            "subdir/file.txt"
        );
    }
}
