//! Privacy classification survives changes to an accessible object's current role.
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct SensitiveIdentities {
    purposes: HashMap<usize, &'static str>,
}

impl SensitiveIdentities {
    pub(crate) fn observe(&mut self, id: usize, password: bool) -> bool {
        if password {
            self.purposes.insert(id, "password");
        }
        self.purposes.contains_key(&id)
    }

    pub(crate) fn mark_secret(&mut self, id: usize) {
        self.purposes.entry(id).or_insert("generic-secret");
    }

    pub(crate) fn purpose(&self, id: usize) -> &'static str {
        self.purposes.get(&id).copied().unwrap_or("generic-secret")
    }
}

#[cfg(test)]
mod tests {
    use super::SensitiveIdentities;

    #[test]
    fn reveal_and_sensitive_fill_cannot_downgrade_an_observed_password() {
        let mut identities = SensitiveIdentities::default();
        assert!(identities.observe(1, true));
        assert!(identities.observe(1, false));
        identities.mark_secret(1);
        assert_eq!(identities.purpose(1), "password");
        assert!(!identities.observe(2, false));
    }

    #[test]
    fn explicit_secret_can_be_promoted_to_password_but_not_cleared() {
        let mut identities = SensitiveIdentities::default();
        identities.mark_secret(7);
        assert!(identities.observe(7, false));
        assert_eq!(identities.purpose(7), "generic-secret");
        assert!(identities.observe(7, true));
        assert_eq!(identities.purpose(7), "password");
    }
}
