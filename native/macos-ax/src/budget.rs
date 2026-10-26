//! Whole-field observation budgeting, shared by the native backend and portable tests.
#[derive(Debug)]
pub(crate) struct ObservationBudget {
    remaining: usize,
    exhausted: bool,
}
impl ObservationBudget {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            remaining: limit,
            exhausted: false,
        }
    }
    /// Charge escaped JSON, including value/text duplication; never disclose a clipped prefix.
    pub(crate) fn accept(&mut self, text: String) -> Option<String> {
        let cost = serde_json::to_string(&text)
            .expect("serializing a string is infallible")
            .len()
            .saturating_mul(2);
        if cost > self.remaining {
            self.exhausted = true;
            None
        } else {
            self.remaining -= cost;
            Some(text)
        }
    }
    pub(crate) fn exhausted(&self) -> bool {
        self.exhausted
    }
    pub(crate) fn omit(&mut self) {
        self.exhausted = true;
    }
}
#[cfg(test)]
mod tests {
    use super::ObservationBudget;
    #[test]
    fn multibyte_text_is_charged_by_utf8_bytes_and_never_partly_returned() {
        let mut budget = ObservationBudget::new(12);
        assert_eq!(budget.accept("λab".to_owned()), Some("λab".to_owned()));
        assert_eq!(budget.accept("秘密".to_owned()), None);
        assert!(budget.exhausted());
    }
    #[test]
    fn repeated_value_and_text_cannot_exceed_aggregate_budget() {
        let mut budget = ObservationBudget::new(1024);
        let mut serialized_text_bytes = 0;
        for _ in 0..20_000 {
            if let Some(text) = budget.accept("registered-secret".to_owned()) {
                serialized_text_bytes += serde_json::to_string(&text).unwrap().len() * 2;
                assert_eq!(text, "registered-secret");
            }
        }
        assert!(serialized_text_bytes <= 1024);
        assert!(budget.exhausted());
    }
    #[test]
    fn escaped_control_characters_fit_the_wire_budget() {
        let limit = 4 * 1024 * 1024;
        let mut budget = ObservationBudget::new(limit);
        let mut fields = Vec::new();
        for _ in 0..100 {
            if let Some(text) = budget.accept("\0".repeat(65_536)) {
                fields.push(serde_json::json!({"value":text,"text":text}));
            }
        }
        assert!(budget.exhausted());
        assert!(serde_json::to_vec(&fields).unwrap().len() < limit);
    }
    #[test]
    fn per_field_omissions_mark_observation_incomplete() {
        let mut budget = ObservationBudget::new(1024);
        budget.omit();
        assert!(budget.exhausted());
        assert_eq!(budget.accept("safe".to_owned()), Some("safe".to_owned()));
    }
}
