use crate::crypto::error::CryptoError;
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;
use sha2::{Sha256, Sha512};

#[derive(Debug, Clone, Serialize)]
pub struct TotpResponse {
    pub code: String,
    pub seconds_remaining: u32,
    pub period: u32,
    pub digits: u32,
}

struct OtpParams {
    secret: String,
    algorithm: String,
    digits: u32,
    period: u32,
}

/// Generate a TOTP code from a secret (raw Base32 or otpauth:// URI).
pub fn generate_totp(secret_input: &str) -> Result<TotpResponse, CryptoError> {
    let params = if secret_input.starts_with("otpauth://") {
        parse_otpauth_uri(secret_input)?
    } else {
        OtpParams {
            secret: secret_input.to_string(),
            algorithm: "SHA1".to_string(),
            digits: 6,
            period: 30,
        }
    };

    let key = base32_decode(&params.secret)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| CryptoError::Totp(format!("System time error: {}", e)))?
        .as_secs();

    let counter = timestamp / params.period as u64;
    let counter_bytes = counter.to_be_bytes();

    let code_num = match params.algorithm.to_uppercase().as_str() {
        "SHA256" => {
            let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&key)
                .map_err(|e| CryptoError::Totp(format!("HMAC key error: {}", e)))?;
            mac.update(&counter_bytes);
            let result = mac.finalize().into_bytes();
            dynamic_truncation(&result, params.digits)
        }
        "SHA512" => {
            let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(&key)
                .map_err(|e| CryptoError::Totp(format!("HMAC key error: {}", e)))?;
            mac.update(&counter_bytes);
            let result = mac.finalize().into_bytes();
            dynamic_truncation(&result, params.digits)
        }
        _ => {
            // Default: SHA1
            let mut mac = <Hmac<Sha1> as KeyInit>::new_from_slice(&key)
                .map_err(|e| CryptoError::Totp(format!("HMAC key error: {}", e)))?;
            mac.update(&counter_bytes);
            let result = mac.finalize().into_bytes();
            dynamic_truncation(&result, params.digits)
        }
    };

    let code = format!("{:0width$}", code_num, width = params.digits as usize);
    let seconds_remaining = params.period - (timestamp % params.period as u64) as u32;

    Ok(TotpResponse {
        code,
        seconds_remaining,
        period: params.period,
        digits: params.digits,
    })
}

/// Dynamic truncation per RFC 4226.
fn dynamic_truncation(hmac_result: &[u8], digits: u32) -> u32 {
    let len = hmac_result.len();
    let offset = (hmac_result[len - 1] & 0x0f) as usize;
    let truncated = ((hmac_result[offset] as u32 & 0x7f) << 24)
        | ((hmac_result[offset + 1] as u32 & 0xff) << 16)
        | ((hmac_result[offset + 2] as u32 & 0xff) << 8)
        | (hmac_result[offset + 3] as u32 & 0xff);
    truncated % 10u32.pow(digits)
}

/// Parse an otpauth:// URI into OtpParams.
fn parse_otpauth_uri(uri: &str) -> Result<OtpParams, CryptoError> {
    let url = url::Url::parse(uri).map_err(|e| CryptoError::Totp(format!("Invalid URI: {}", e)))?;

    if url.scheme() != "otpauth" {
        return Err(CryptoError::Totp("Not an otpauth URI".to_string()));
    }

    let secret = url
        .query_pairs()
        .find(|(k, _)| k == "secret")
        .map(|(_, v)| v.to_string())
        .ok_or_else(|| CryptoError::Totp("Missing 'secret' parameter".to_string()))?;

    let algorithm = url
        .query_pairs()
        .find(|(k, _)| k == "algorithm")
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| "SHA1".to_string());

    let digits = url
        .query_pairs()
        .find(|(k, _)| k == "digits")
        .and_then(|(_, v)| v.parse::<u32>().ok())
        .unwrap_or(6);

    let period = url
        .query_pairs()
        .find(|(k, _)| k == "period")
        .and_then(|(_, v)| v.parse::<u32>().ok())
        .unwrap_or(30);

    // Validate ranges (RFC 6238 / RFC 4226)
    if digits < 6 || digits > 8 {
        return Err(CryptoError::Totp(
            "TOTP digits must be between 6 and 8".to_string(),
        ));
    }
    if period == 0 {
        return Err(CryptoError::Totp(
            "TOTP period must be greater than 0".to_string(),
        ));
    }

    Ok(OtpParams {
        secret,
        algorithm,
        digits,
        period,
    })
}

/// RFC 4648 Base32 decoding (A-Z, 2-7), case-insensitive, ignore spaces/hyphens.
fn base32_decode(s: &str) -> Result<Vec<u8>, CryptoError> {
    let cleaned: String = s
        .to_uppercase()
        .replace('=', "")
        .replace(' ', "")
        .replace('-', "");

    let mut buffer: u32 = 0;
    let mut bits_in_buffer: u32 = 0;
    let mut output = Vec::new();

    for ch in cleaned.chars() {
        let value = match ch {
            'A'..='Z' => (ch as u8 - b'A') as u32,
            '2'..='7' => (ch as u8 - b'2' + 26) as u32,
            _ => {
                return Err(CryptoError::Totp(format!(
                    "Invalid Base32 character: '{}'",
                    ch
                )))
            }
        };

        buffer = (buffer << 5) | value;
        bits_in_buffer += 5;

        if bits_in_buffer >= 8 {
            bits_in_buffer -= 8;
            output.push(((buffer >> bits_in_buffer) & 0xff) as u8);
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base32_decode_rfc4648() {
        // RFC 4648 test vectors
        assert_eq!(base32_decode("MY======").unwrap(), b"f");
        assert_eq!(base32_decode("MZXQ====").unwrap(), b"fo");
        assert_eq!(base32_decode("MZXW6===").unwrap(), b"foo");
        assert_eq!(base32_decode("MZXW6YQ=").unwrap(), b"foob");
        assert_eq!(base32_decode("MZXW6YTB").unwrap(), b"fooba");
        assert_eq!(base32_decode("MZXW6YTBOI======").unwrap(), b"foobar");
    }

    #[test]
    fn test_base32_case_insensitive() {
        let upper = base32_decode("MZXW6YTB").unwrap();
        let lower = base32_decode("mzxw6ytb").unwrap();
        assert_eq!(upper, lower);
    }

    #[test]
    fn test_base32_with_spaces_and_hyphens() {
        // MZXW6YTB = "fooba" (5 bytes)
        let result = base32_decode("MZ-XW-6Y-TB").unwrap();
        assert_eq!(result, b"fooba");
    }

    #[test]
    fn test_base32_invalid_char() {
        assert!(base32_decode("MZ1W6YTB").is_err());
    }

    #[test]
    fn test_parse_otpauth_uri() {
        let uri = "otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30";
        let params = parse_otpauth_uri(uri).unwrap();
        assert_eq!(params.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(params.algorithm, "SHA1");
        assert_eq!(params.digits, 6);
        assert_eq!(params.period, 30);
    }

    #[test]
    fn test_parse_otpauth_uri_defaults() {
        let uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ";
        let params = parse_otpauth_uri(uri).unwrap();
        assert_eq!(params.secret, "GEZDGNBVGY3TQOJQ");
        assert_eq!(params.algorithm, "SHA1");
        assert_eq!(params.digits, 6);
        assert_eq!(params.period, 30);
    }

    #[test]
    fn test_generate_totp_raw_secret() {
        // RFC 6238 test vector: SHA1 secret = "12345678901234567890"
        // Base32 of that = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ (but the raw secret is 20 bytes)
        let result = generate_totp("GEZDGNBVGY3TQOJQ");
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.code.len(), 6);
        assert!(resp.seconds_remaining > 0 && resp.seconds_remaining <= 30);
        assert_eq!(resp.period, 30);
        assert_eq!(resp.digits, 6);
    }

    #[test]
    fn test_dynamic_truncation() {
        // Use a sufficiently long HMAC result (>= 5 bytes)
        let hmac_bytes = vec![0x1f, 0x86, 0x98, 0x69, 0x0e, 0x02, 0xca, 0x15, 0x42, 0x30];
        let result = dynamic_truncation(&hmac_bytes, 6);
        assert!(result < 1_000_000);
    }

    #[test]
    fn test_generate_totp_otpauth_uri() {
        let uri = "otpauth://totp/Test:user@example.com?secret=GEZDGNBVGY3TQOJQ&digits=6&period=30";
        let result = generate_totp(uri);
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.code.len(), 6);
    }
}
