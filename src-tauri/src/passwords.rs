use crate::db::{DbError, ErrorCode};
use keyring::{Entry, Error};

const SERVICE: &str = "com.myersguo.mdb";

pub fn access_error() -> DbError {
    // Credential errors can contain secret bytes; return only application-owned guidance.
    DbError::coded(
        ErrorCode::CredentialAccess,
        "Could not access the system credential store. Unlock it and retry.",
    )
}

fn entry(profile_id: &str) -> Result<Entry, DbError> {
    if profile_id.is_empty() || profile_id.len() > 128 || profile_id.chars().any(char::is_control) {
        return Err(access_error());
    }
    Entry::new(SERVICE, profile_id).map_err(|_| access_error())
}

pub fn get(profile_id: &str) -> Result<Option<String>, DbError> {
    match entry(profile_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(access_error()),
    }
}

pub fn save(profile_id: &str, password: &str) -> Result<(), DbError> {
    entry(profile_id)?
        .set_password(password)
        .map_err(|_| access_error())
}

pub fn delete(profile_id: &str) -> Result<(), DbError> {
    match entry(profile_id)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err(access_error()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_profile_ids_without_accessing_credentials() {
        for id in ["", "invalid\0id", "line\nbreak", &"x".repeat(129)] {
            let error = get(id).unwrap_err();
            assert_eq!(
                serde_json::to_value(error).unwrap()["code"],
                "credential_access"
            );
            assert!(save(id, "synthetic-password").is_err());
            assert!(delete(id).is_err());
        }
    }

    #[test]
    #[ignore = "Uses a disposable system credential: run npm run test:credentials"]
    fn native_roundtrip() {
        let id = format!(
            "test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let outcome = std::panic::catch_unwind(|| {
            assert_eq!(get(&id).unwrap(), None);
            save(&id, "mdb-synthetic-test-password").unwrap();
            assert_eq!(
                get(&id).unwrap().as_deref(),
                Some("mdb-synthetic-test-password")
            );
            save(&id, "").unwrap();
            assert_eq!(get(&id).unwrap().as_deref(), Some(""));
            delete(&id).unwrap();
            assert_eq!(get(&id).unwrap(), None);
            delete(&id).unwrap();
        });
        delete(&id).expect("Remove disposable test credential");
        outcome.unwrap();
    }
}
