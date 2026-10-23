# h# property report

Generated: 2026-10-23T13:51:28.299Z
Seed: 1 · cases: 3 · max size: 2

| Cases | Target runs | Passed | Failed | Blocked |
|---:|---:|---:|---:|---:|
| 3 | 3 | 3 | 0 | 0 |

## seed-1-size-1 — passed

Reference: E_OVERFLOW @ node 39

- **csharp**: passed — E_OVERFLOW @ node 39

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32) -> i32 {
    let v1: bool = (false || false);
    if true {
        return (3 + 1);
    }
    else {
        return (3 + -7);
    }
    return 1;
}

fn main() -> i32 {
    let v1: i32 = (-7 * 2);
    if false {
        return (-0);
    }
    return (--2147483648);
}
```

</details>

## seed-2-size-2 — passed

Reference: i32 -40

- **csharp**: passed — i32 -40

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32, p2: i32) -> i32 {
    let v1: bool = (!((p2 == 0)));
    let v2: i32 = (42 * (-p1));
    if (v1 && false) {
        return ((3 + 1) * 7);
    }
    else {
        return -2147483648;
    }
    return ((-2147483648 + 7) + 42);
}

fn f2() -> bool {
    let v1: bool = (!((false && false)));
    let v2: bool = (!(false));
    if (!(false)) {
        return (false || (!(false)));
    }
    return (!(true));
}

fn main() -> i32 {
    let v1: bool = f2();
    let v2: i32 = (2 * (-7 + 3));
    if ((!(false)) || v1) {
        return ((-42) + 2);
    }
    return 0;
}
```

</details>

## seed-3-size-1 — passed

Reference: i32 1

- **csharp**: passed — i32 1

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32, p2: i32) -> i32 {
    let v1: bool = (!(true));
    if true {
        return p2;
    }
    return (-2147483647);
}

fn main() -> i32 {
    let v1: i32 = (-1 - 10);
    if (!(true)) {
        return (-2147483648 - -7);
    }
    return (2 + -1);
}
```

</details>

