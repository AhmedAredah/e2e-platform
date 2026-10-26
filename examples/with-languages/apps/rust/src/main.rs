mod domain;
mod http;
use domain::{Calculator, Operation, PlantedFault, SumOperation};
use http::CalculatorServer;

struct Application;
impl Application {
    fn run(&self, arguments: Vec<String>) -> Result<(), String> {
        let wrong = arguments.iter().any(|argument| argument == "--wrong-result");
        let arguments: Vec<_> = arguments.into_iter().filter(|argument| argument != "--wrong-result").collect();
        let operation: Box<dyn Operation> = Box::new(SumOperation);
        let calculator = Calculator(if wrong { Box::new(PlantedFault(operation)) } else { operation });
        match arguments.as_slice() {
            [command, a, b] if command == "sum" => { println!("{}", calculator.calculate(a, b)?); Ok(()) },
            [command] if command == "serve" => CalculatorServer::new(&calculator).serve(),
            _ => Err("usage: sum <a> <b> | serve [--wrong-result]".into()),
        }
    }
}
fn main() {
    if let Err(error) = Application.run(std::env::args().skip(1).collect()) {
        eprintln!("{error}");
        std::process::exit(2);
    }
}
