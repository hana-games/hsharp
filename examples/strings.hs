fn choose(flag: bool) -> string {
    if flag {
        return "yes";
    }
    return "no";
}

fn main() -> bool {
    let greeting: string = "héllo\nworld";
    let copy: string = greeting;
    let selected: string = choose(true);
    return greeting == copy && greeting != "other" && selected == "yes" && choose(false) == "no";
}
