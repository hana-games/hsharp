// Benchmark small: representative function, local, condition, and return.
fn calculate(x: i32, bonus: bool) -> i32 {
    let base: i32 = x * 3;

    if bonus {
        return base + 2;
    }

    return base;
}
