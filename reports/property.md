# h# property report

Generated: 2026-10-23T14:49:18.307Z
Seed: 1 · cases: 10 · max size: 3

| Cases | Target runs | Passed | Failed | Blocked |
|---:|---:|---:|---:|---:|
| 10 | 40 | 10 | 0 | 0 |

## seed-1-size-1 — passed

Reference: E_OVERFLOW @ node 39

- **csharp**: passed — E_OVERFLOW @ node 39
- **rust**: passed — E_OVERFLOW @ node 39
- **go**: passed — E_OVERFLOW @ node 39
- **java**: passed — E_OVERFLOW @ node 39

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
- **rust**: passed — i32 -40
- **go**: passed — i32 -40
- **java**: passed — i32 -40

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

## seed-3-size-3 — passed

Reference: E_OVERFLOW @ node 26

- **csharp**: passed — E_OVERFLOW @ node 26
- **rust**: passed — E_OVERFLOW @ node 26
- **go**: passed — E_OVERFLOW @ node 26
- **java**: passed — E_OVERFLOW @ node 26

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32, p2: i32) -> i32 {
    let v1: bool = (!(true));
    let v2: i32 = p2;
    if (!(v1)) {
        return (((p1 * 2147483647) * (--1)) - (2 * (p1 + 3)));
    }
    return (((2 + 7) * (3 - 3)) * (-(2 * 42)));
}

fn f2(p1: i32, p2: bool) -> bool {
    let v1: bool = false;
    let v2: i32 = 7;
    if (((!(true)) || (f1(-2147483648, 42) == -1)) || v1) {
        return true;
    }
    return false;
}

fn main() -> i32 {
    let v1: bool = false;
    let v2: bool = (((42 + 10) - 2147483647) < ((-f1(-1, 0)) + -2147483648));
    if (v1 && ((-7 * 0) <= 42)) {
        return (((-2147483648 + 1) - (7 - 10)) * -1);
    }
    else {
        return (-((-f1(0, 1)) - 2147483647));
    }
    return (-((0 - 0) + (f1(10, 7) + 3)));
}
```

</details>

## seed-4-size-1 — passed

Reference: i32 43

- **csharp**: passed — i32 43
- **rust**: passed — i32 43
- **go**: passed — i32 43
- **java**: passed — i32 43

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32, p2: i32) -> i32 {
    let v1: i32 = (-2147483648 + 42);
    if (2 == 2147483647) {
        return (2 * 3);
    }
    return (-3);
}

fn main() -> i32 {
    let v1: i32 = (-7 - 10);
    if (!(true)) {
        return (-1 * f1(-7, 3));
    }
    else {
        return (42 + 1);
    }
    return (-2147483648 + 2147483647);
}
```

</details>

## seed-5-size-2 — passed

Reference: E_OVERFLOW @ node 37

- **csharp**: passed — E_OVERFLOW @ node 37
- **rust**: passed — E_OVERFLOW @ node 37
- **go**: passed — E_OVERFLOW @ node 37
- **java**: passed — E_OVERFLOW @ node 37

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: bool, p2: i32) -> i32 {
    let v1: i32 = ((-1) * (42 * p2));
    let v2: i32 = (--1);
    if (false || p1) {
        return 3;
    }
    return v1;
}

fn f2(p1: i32, p2: i32) -> bool {
    let v1: i32 = ((2147483647 * 7) + (p2 * 10));
    let v2: i32 = (-(2147483647 + 1));
    if true {
        return false;
    }
    else {
        return ((0 >= p2) && false);
    }
    return ((false && false) || false);
}

fn main() -> i32 {
    let v1: bool = (!((10 < 2)));
    let v2: i32 = 2;
    if (f2(-7, 42) && (f2(-2147483648, 2) && true)) {
        return ((-10) + 2);
    }
    return 3;
}
```

</details>

## seed-6-size-3 — passed

Reference: E_OVERFLOW @ node 11

- **csharp**: passed — E_OVERFLOW @ node 11
- **rust**: passed — E_OVERFLOW @ node 11
- **go**: passed — E_OVERFLOW @ node 11
- **java**: passed — E_OVERFLOW @ node 11

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: i32) -> bool {
    let v1: i32 = (-2147483648 + ((p1 - p1) + (-42)));
    let v2: i32 = ((--2147483648) + (-(--2147483648)));
    if ((true || (!(false))) || false) {
        return (((-v2) - (42 - p1)) <= 0);
    }
    else {
        return true;
    }
    return true;
}

fn f2() -> bool {
    let v1: i32 = 10;
    let v2: i32 = 7;
    if (false || f1((-1 * 2147483647))) {
        return true;
    }
    return (false && f1((-1 - 7)));
}

fn main() -> i32 {
    let v1: bool = (true && (!(f1(2))));
    let v2: i32 = -7;
    if (((!(false)) && f1(-1)) && f1((-1 + 0))) {
        return (-7 + (-2147483648 * (42 * -7)));
    }
    else {
        return 3;
    }
    return ((2147483647 + 0) * ((2147483647 + 3) * (2 - 1)));
}
```

</details>

## seed-7-size-1 — passed

Reference: i32 10

- **csharp**: passed — i32 10
- **rust**: passed — i32 10
- **go**: passed — i32 10
- **java**: passed — i32 10

<details><summary>Seed source</summary>

```hsharp
fn f1() -> i32 {
    let v1: bool = (!(true));
    if (true || false) {
        return 1;
    }
    return (7 + 3);
}

fn main() -> i32 {
    let v1: i32 = -2147483648;
    if false {
        return f1();
    }
    else {
        return 10;
    }
    return (2147483647 + 10);
}
```

</details>

## seed-8-size-2 — passed

Reference: E_OVERFLOW @ node 67

- **csharp**: passed — E_OVERFLOW @ node 67
- **rust**: passed — E_OVERFLOW @ node 67
- **go**: passed — E_OVERFLOW @ node 67
- **java**: passed — E_OVERFLOW @ node 67

<details><summary>Seed source</summary>

```hsharp
fn f1() -> i32 {
    let v1: i32 = ((-2) * (10 + 0));
    let v2: i32 = 0;
    if (v2 < (-1 - -7)) {
        return 3;
    }
    return ((2147483647 + 2) - (-7));
}

fn f2(p1: bool, p2: bool) -> i32 {
    let v1: i32 = 2;
    let v2: bool = (!(p2));
    if p2 {
        return ((0 * 3) + f1());
    }
    return (-2147483648 + (-3));
}

fn main() -> i32 {
    let v1: i32 = 3;
    let v2: i32 = ((0 - -2147483648) + (-10));
    if true {
        return 7;
    }
    return (-(0 * 42));
}
```

</details>

## seed-9-size-3 — passed

Reference: E_OVERFLOW @ node 8

- **csharp**: passed — E_OVERFLOW @ node 8
- **rust**: passed — E_OVERFLOW @ node 8
- **go**: passed — E_OVERFLOW @ node 8
- **java**: passed — E_OVERFLOW @ node 8

<details><summary>Seed source</summary>

```hsharp
fn f1() -> bool {
    let v1: i32 = (((42 + -1) - (-2147483648 - 3)) * ((2147483647 * 2147483647) * (-2)));
    let v2: bool = (((!(true)) || (1 < 7)) && (10 != (10 + 2)));
    if (((7 * 1) * (42 * 10)) >= (--1)) {
        return true;
    }
    return ((--1) != -2147483648);
}

fn f2(p1: bool, p2: i32) -> bool {
    let v1: i32 = (-42);
    let v2: i32 = (7 * -7);
    if (!(p1)) {
        return true;
    }
    return f1();
}

fn main() -> i32 {
    let v1: bool = ((f1() && f1()) && false);
    let v2: i32 = (((-2147483648 * 2147483647) - (-2147483648 - -2147483648)) * 3);
    if f2(true, (-v2)) {
        return (-(-(-2147483647)));
    }
    return (-3);
}
```

</details>

## seed-10-size-1 — passed

Reference: i32 11

- **csharp**: passed — i32 11
- **rust**: passed — i32 11
- **go**: passed — i32 11
- **java**: passed — i32 11

<details><summary>Seed source</summary>

```hsharp
fn f1(p1: bool) -> bool {
    let v1: bool = (!(p1));
    if p1 {
        return p1;
    }
    return (!(false));
}

fn main() -> i32 {
    let v1: i32 = (-1);
    if (10 > 2) {
        return (10 - v1);
    }
    return v1;
}
```

</details>

