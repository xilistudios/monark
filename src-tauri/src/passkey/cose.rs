//! COSE (RFC 9052/9053) and `attestationObject` CBOR encoding for ES256.
//!
//! Everything is built on [`ciborium::value::Value`] so that the integer map
//! keys of a COSE_Key are explicit: serde's struct-to-map encoding cannot
//! express `{-2: <bytes>}` without a custom serializer, and a COSE_Key whose
//! keys came out as text would be rejected by every relying party.
//!
//! Encoding rules we rely on (and pin with tests):
//!
//! * `kty` (1) = `2` (EC2), `alg` (3) = `-7` (ES256), `crv` (-1) = `1` (P-256),
//!   `x` (-2) / `y` (-3) = 32-byte big-endian coordinates.
//! * Coordinates are always the **uncompressed** SEC1 point (0x04 || X || Y);
//!   compressed points are rejected on parse.
//! * `attestationObject` = `{"fmt": "none", "attStmt": {}, "authData": bstr}`.

use crate::commands::errors::CommandError;
use crate::passkey::es256::ALG_ES256;
use ciborium::value::Value;
use p256::ecdsa::VerifyingKey;

/// COSE key type `EC2`.
const COSE_KTY_EC2: i64 = 2;
/// COSE elliptic curve `P-256` (a.k.a. `secp256r1`).
const COSE_CRV_P256: i64 = 1;
/// Length of a P-256 field element in bytes.
const P256_COORD_LEN: usize = 32;
/// Attestation statement format produced by this authenticator (ruling Q3).
pub const ATTESTATION_FMT_NONE: &str = "none";

fn validation(message: &str) -> CommandError {
    CommandError::Validation(message.to_string())
}

fn cbor_error() -> CommandError {
    CommandError::Serialization("CBOR encoding failed".to_string())
}

/// Builds the COSE_Key for a P-256 public key.
///
/// The map is `{1: 2, 3: -7, -1: 1, -2: x, -3: y}` — exactly the shape a
/// relying party expects inside `authenticatorData.attestedCredentialData`.
pub fn cose_key_from_verifying(key: &VerifyingKey) -> Result<Value, CommandError> {
    let point = key.to_encoded_point(false);
    let x = point
        .x()
        .ok_or_else(|| validation("Public key has no X coordinate"))?;
    let y = point
        .y()
        .ok_or_else(|| validation("Public key has no Y coordinate"))?;
    Ok(Value::Map(vec![
        (
            Value::Integer(1.into()),
            Value::Integer(COSE_KTY_EC2.into()),
        ),
        (
            Value::Integer(3.into()),
            Value::Integer(i64::from(ALG_ES256).into()),
        ),
        (
            Value::Integer((-1).into()),
            Value::Integer(COSE_CRV_P256.into()),
        ),
        (Value::Integer((-2).into()), Value::Bytes(x.to_vec())),
        (Value::Integer((-3).into()), Value::Bytes(y.to_vec())),
    ]))
}

/// Reads a COSE_Key and reconstructs the public key, strictly.
///
/// Rejected (all as `CommandError::Validation`, never a panic):
/// non-map values, duplicate keys, a non-integer key, `kty != 2`, `alg != -7`,
/// `crv != 1`, coordinates that are not byte strings, coordinates whose length
/// is not 32 bytes, and points that are not on the curve.
pub fn verifying_key_from_cose(value: &Value) -> Result<VerifyingKey, CommandError> {
    let entries = match value {
        Value::Map(entries) => entries,
        _ => return Err(validation("COSE key is not a map")),
    };

    let mut kty: Option<i128> = None;
    let mut alg: Option<i128> = None;
    let mut crv: Option<i128> = None;
    let mut x: Option<&Vec<u8>> = None;
    let mut y: Option<&Vec<u8>> = None;

    for (key, entry) in entries {
        let label = match key {
            Value::Integer(int) => i128::from(*int),
            _ => return Err(validation("COSE key label is not an integer")),
        };
        let slot = match label {
            1 => &mut kty,
            3 => &mut alg,
            -1 => &mut crv,
            -2 => {
                if x.is_some() {
                    return Err(validation("COSE key has a duplicate label"));
                }
                match entry {
                    Value::Bytes(bytes) => {
                        x = Some(bytes);
                        continue;
                    }
                    _ => return Err(validation("COSE key coordinate is not a byte string")),
                }
            }
            -3 => {
                if y.is_some() {
                    return Err(validation("COSE key has a duplicate label"));
                }
                match entry {
                    Value::Bytes(bytes) => {
                        y = Some(bytes);
                        continue;
                    }
                    _ => return Err(validation("COSE key coordinate is not a byte string")),
                }
            }
            // Unknown labels are ignored (COSE allows extra parameters).
            _ => continue,
        };
        let int = match entry {
            Value::Integer(int) => i128::from(*int),
            _ => return Err(validation("COSE key parameter is not an integer")),
        };
        if slot.replace(int).is_some() {
            return Err(validation("COSE key has a duplicate label"));
        }
    }

    if kty != Some(i128::from(COSE_KTY_EC2)) {
        return Err(validation("COSE key is not an EC2 key"));
    }
    if alg != Some(i128::from(ALG_ES256)) {
        return Err(validation("COSE key algorithm is not ES256"));
    }
    if crv != Some(i128::from(COSE_CRV_P256)) {
        return Err(validation("COSE key curve is not P-256"));
    }
    let x = x.ok_or_else(|| validation("COSE key is missing the X coordinate"))?;
    let y = y.ok_or_else(|| validation("COSE key is missing the Y coordinate"))?;
    if x.len() != P256_COORD_LEN || y.len() != P256_COORD_LEN {
        return Err(validation("COSE key coordinate has the wrong length"));
    }

    let mut sec1 = Vec::with_capacity(1 + 2 * P256_COORD_LEN);
    sec1.push(0x04);
    sec1.extend_from_slice(x);
    sec1.extend_from_slice(y);
    VerifyingKey::from_sec1_bytes(&sec1)
        .map_err(|_| validation("COSE key point is not on the P-256 curve"))
}

/// Wraps `authData` in an `attestationObject` with format `"none"`.
///
/// `attStmt` is the empty map, as required for the `none` format (WebAuthn L2
/// §8.7).
pub fn attestation_object_none(auth_data: &[u8]) -> Result<Vec<u8>, CommandError> {
    let object = Value::Map(vec![
        (
            Value::Text("fmt".to_string()),
            Value::Text(ATTESTATION_FMT_NONE.to_string()),
        ),
        (Value::Text("attStmt".to_string()), Value::Map(Vec::new())),
        (
            Value::Text("authData".to_string()),
            Value::Bytes(auth_data.to_vec()),
        ),
    ]);
    let mut out = Vec::new();
    ciborium::ser::into_writer(&object, &mut out).map_err(|_| cbor_error())?;
    Ok(out)
}

/// Parses an `attestationObject` into `(fmt, attStmt, authData)`.
///
/// Only the `"none"` format is accepted in F0: Monark issues nothing else, and
/// accepting a richer attestation statement would mean validating it.
pub fn parse_attestation_object(bytes: &[u8]) -> Result<(String, Value, Vec<u8>), CommandError> {
    let value: Value = ciborium::de::from_reader(bytes)
        .map_err(|_| validation("Attestation object is not valid CBOR"))?;
    let entries = match value {
        Value::Map(entries) => entries,
        _ => return Err(validation("Attestation object is not a map")),
    };

    let mut fmt = None;
    let mut att_stmt = None;
    let mut auth_data = None;
    for (key, entry) in entries {
        let label = match key {
            Value::Text(text) => text,
            _ => return Err(validation("Attestation object key is not text")),
        };
        match label.as_str() {
            "fmt" => match entry {
                Value::Text(text) => fmt = Some(text),
                _ => return Err(validation("Attestation object fmt is not text")),
            },
            "attStmt" => att_stmt = Some(entry),
            "authData" => match entry {
                Value::Bytes(bytes) => auth_data = Some(bytes),
                _ => {
                    return Err(validation(
                        "Attestation object authData is not a byte string",
                    ))
                }
            },
            _ => {}
        }
    }

    let fmt = fmt.ok_or_else(|| validation("Attestation object is missing fmt"))?;
    if fmt != ATTESTATION_FMT_NONE {
        return Err(validation("Unsupported attestation format"));
    }
    let att_stmt = att_stmt.ok_or_else(|| validation("Attestation object is missing attStmt"))?;
    let auth_data =
        auth_data.ok_or_else(|| validation("Attestation object is missing authData"))?;
    Ok((fmt, att_stmt, auth_data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::passkey::es256::{generate_signing_key, verifying_key_from_signing};

    fn sample_key() -> VerifyingKey {
        verifying_key_from_signing(&generate_signing_key().expect("generate"))
    }

    fn roundtrip_through_cbor(value: &Value) -> Value {
        let mut bytes = Vec::new();
        ciborium::ser::into_writer(value, &mut bytes).expect("encode");
        ciborium::de::from_reader(bytes.as_slice()).expect("decode")
    }

    fn cose_map(kty: i64, alg: i64, crv: i64, x: Vec<u8>, y: Vec<u8>) -> Value {
        Value::Map(vec![
            (Value::Integer(1.into()), Value::Integer(kty.into())),
            (Value::Integer(3.into()), Value::Integer(alg.into())),
            (Value::Integer((-1).into()), Value::Integer(crv.into())),
            (Value::Integer((-2).into()), Value::Bytes(x)),
            (Value::Integer((-3).into()), Value::Bytes(y)),
        ])
    }

    fn coords(key: &VerifyingKey) -> (Vec<u8>, Vec<u8>) {
        let point = key.to_encoded_point(false);
        (
            point.x().expect("x").to_vec(),
            point.y().expect("y").to_vec(),
        )
    }

    #[test]
    fn cose_key_roundtrips_through_cbor() {
        let key = sample_key();
        let cose = cose_key_from_verifying(&key).expect("encode");
        let decoded = roundtrip_through_cbor(&cose);
        let recovered = verifying_key_from_cose(&decoded).expect("decode");
        assert_eq!(
            recovered.to_encoded_point(false),
            key.to_encoded_point(false)
        );
    }

    #[test]
    fn cose_key_has_exact_integer_labels() {
        let key = sample_key();
        let cose = cose_key_from_verifying(&key).expect("encode");
        let entries = match cose {
            Value::Map(entries) => entries,
            _ => panic!("expected a map"),
        };
        let labels: Vec<i128> = entries
            .iter()
            .map(|(k, _)| match k {
                Value::Integer(i) => i128::from(*i),
                _ => panic!("label must be an integer"),
            })
            .collect();
        assert_eq!(labels, vec![1, 3, -1, -2, -3]);
    }

    #[test]
    fn rejects_wrong_alg() {
        let key = sample_key();
        let (x, y) = coords(&key);
        let cose = cose_map(2, -8, 1, x, y);
        assert!(verifying_key_from_cose(&cose).is_err());
    }

    #[test]
    fn rejects_wrong_kty() {
        let key = sample_key();
        let (x, y) = coords(&key);
        assert!(verifying_key_from_cose(&cose_map(1, -7, 1, x, y)).is_err());
    }

    #[test]
    fn rejects_wrong_curve() {
        let key = sample_key();
        let (x, y) = coords(&key);
        assert!(verifying_key_from_cose(&cose_map(2, -7, 2, x, y)).is_err());
    }

    #[test]
    fn rejects_short_coordinate() {
        let key = sample_key();
        let (mut x, y) = coords(&key);
        x.pop();
        assert!(verifying_key_from_cose(&cose_map(2, -7, 1, x, y)).is_err());
    }

    #[test]
    fn rejects_off_curve_point() {
        let key = sample_key();
        let (x, mut y) = coords(&key);
        y[31] ^= 0x01;
        assert!(verifying_key_from_cose(&cose_map(2, -7, 1, x, y)).is_err());
    }

    #[test]
    fn rejects_missing_and_duplicate_labels() {
        let key = sample_key();
        let (x, y) = coords(&key);
        let missing = Value::Map(vec![
            (Value::Integer(1.into()), Value::Integer(2.into())),
            (Value::Integer(3.into()), Value::Integer((-7).into())),
            (Value::Integer((-1).into()), Value::Integer(1.into())),
            (Value::Integer((-2).into()), Value::Bytes(x.clone())),
        ]);
        assert!(verifying_key_from_cose(&missing).is_err());

        let duplicate = Value::Map(vec![
            (Value::Integer(1.into()), Value::Integer(2.into())),
            (Value::Integer(3.into()), Value::Integer((-7).into())),
            (Value::Integer((-1).into()), Value::Integer(1.into())),
            (Value::Integer((-2).into()), Value::Bytes(x.clone())),
            (Value::Integer((-2).into()), Value::Bytes(x)),
            (Value::Integer((-3).into()), Value::Bytes(y)),
        ]);
        assert!(verifying_key_from_cose(&duplicate).is_err());
    }

    #[test]
    fn rejects_non_map_and_text_labels() {
        assert!(verifying_key_from_cose(&Value::Bytes(vec![1, 2, 3])).is_err());
        let text_labels = Value::Map(vec![(
            Value::Text("kty".to_string()),
            Value::Integer(2.into()),
        )]);
        assert!(verifying_key_from_cose(&text_labels).is_err());
    }

    #[test]
    fn attestation_object_roundtrips() {
        let auth_data = vec![0xabu8; 37];
        let encoded = attestation_object_none(&auth_data).expect("encode");
        let (fmt, att_stmt, parsed) = parse_attestation_object(&encoded).expect("parse");
        assert_eq!(fmt, "none");
        assert_eq!(att_stmt, Value::Map(Vec::new()));
        assert_eq!(parsed, auth_data);
    }

    #[test]
    fn attestation_object_rejects_foreign_format() {
        let object = Value::Map(vec![
            (
                Value::Text("fmt".to_string()),
                Value::Text("packed".to_string()),
            ),
            (Value::Text("attStmt".to_string()), Value::Map(Vec::new())),
            (
                Value::Text("authData".to_string()),
                Value::Bytes(vec![0u8; 37]),
            ),
        ]);
        let mut bytes = Vec::new();
        ciborium::ser::into_writer(&object, &mut bytes).expect("encode");
        assert!(parse_attestation_object(&bytes).is_err());
    }

    #[test]
    fn attestation_object_rejects_garbage() {
        assert!(parse_attestation_object(&[]).is_err());
        assert!(parse_attestation_object(&[0xff, 0x00]).is_err());
        assert!(parse_attestation_object(&[0x01]).is_err());
    }
}
