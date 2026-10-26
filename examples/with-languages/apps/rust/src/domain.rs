//! Trait-based extension and composition, rather than class inheritance.
pub trait Operation {
    fn evaluate(&self, left: f64, right: f64) -> f64;
}

pub struct SumOperation;
impl Operation for SumOperation {
    fn evaluate(&self, left: f64, right: f64) -> f64 { left + right }
}

/// Deliberate wrong-result decorator that the negative verification must catch.
pub struct PlantedFault(pub Box<dyn Operation>);
impl Operation for PlantedFault {
    fn evaluate(&self, left: f64, right: f64) -> f64 { self.0.evaluate(left, right) + 1.0 }
}

pub struct Calculator(pub Box<dyn Operation>);
impl Calculator {
    pub fn calculate(&self, left: &str, right: &str) -> Result<String, String> {
        let a = left.parse::<f64>().map_err(|_| "invalid operands")?;
        let b = right.parse::<f64>().map_err(|_| "invalid operands")?;
        let sum = self.0.evaluate(a, b);
        if !a.is_finite() || !b.is_finite() || !sum.is_finite() { return Err("operands and result must be finite".into()); }
        Ok(format!("{{\"schemaVersion\":1,\"operation\":\"sum\",\"operands\":[{a},{b}],\"sum\":{sum}}}"))
    }
}
