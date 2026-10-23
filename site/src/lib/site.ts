import { siteData } from "../data/data";
import type { ProfileKeywords, TargetId } from "../data/types";

export const site = {
  name: "h#",
  version: siteData.meta.compilerVersion,
  coreVersion: siteData.meta.coreVersion,
  description:
    "One semantic core. Personal syntax. Native C#, Rust, Go, and Java output.",
  github: "https://github.com/hana-games/hsharp",
  owner: "HANAGAMES.net",
  ownerUrl: "https://hanagames.net",
};

export const targets: {
  id: TargetId;
  label: string;
  color: string;
  soft: string;
  logo: string;
  description: string;
  command: string;
}[] = [
  {
    id: "csharp",
    label: "C#",
    color: "var(--csharp)",
    soft: "var(--csharp-soft)",
    logo: "/brands/csharp.svg",
    description: "int, long checks, internal result records.",
    command: "dotnet build",
  },
  {
    id: "rust",
    label: "Rust",
    color: "var(--rust)",
    soft: "var(--rust-soft)",
    logo: "/brands/rust.svg",
    description: "i32, i64 checks, Result-style propagation.",
    command: "cargo build --release",
  },
  {
    id: "go",
    label: "Go",
    color: "var(--go)",
    soft: "var(--go-soft)",
    logo: "/brands/go.svg",
    description: "int32, int64 checks, explicit result structs.",
    command: "go build",
  },
  {
    id: "java",
    label: "Java",
    color: "var(--java)",
    soft: "var(--java-soft)",
    logo: "/brands/java.svg",
    description: "int, long checks, nested result class.",
    command: "javac + java",
  },
];

export const profiles: {
  id: string;
  label: string;
  keywords: ProfileKeywords;
  note: string;
}[] = [
  {
    id: "standard",
    label: "Standard",
    keywords: {
      fn: "fn",
      let: "let",
      if: "if",
      else: "else",
      return: "return",
      true: "true",
      false: "false",
    },
    note: "Canonical source",
  },
  {
    id: "my-syntax",
    label: "my-syntax",
    keywords: {
      fn: "function",
      let: "value",
      if: "when",
      else: "otherwise",
      return: "give",
      true: "yes",
      false: "no",
    },
    note: "Supplied personal profile",
  },
  {
    id: "terse",
    label: "terse",
    keywords: {
      fn: "def",
      let: "val",
      if: "when",
      else: "other",
      return: "yield",
      true: "yes",
      false: "no",
    },
    note: "Compact notation",
  },
  {
    id: "casual",
    label: "casual",
    keywords: {
      fn: "fun",
      let: "bind",
      if: "suppose",
      else: "otherwise",
      return: "deliver",
      true: "yep",
      false: "nope",
    },
    note: "User-created profile",
  },
];

export const roleLabels: { role: keyof ProfileKeywords; canonical: string; description: string }[] = [
  { role: "fn", canonical: "fn", description: "function declaration" },
  { role: "let", canonical: "let", description: "immutable local" },
  { role: "if", canonical: "if", description: "conditional" },
  { role: "else", canonical: "else", description: "alternative branch" },
  { role: "return", canonical: "return", description: "return a value" },
  { role: "true", canonical: "true", description: "Boolean true" },
  { role: "false", canonical: "false", description: "Boolean false" },
];

export const nav = [
  { href: "/", label: "Overview" },
  { href: "/why", label: "Why h#" },
  { href: "/examples", label: "Examples" },
  { href: "/playground", label: "Playground" },
  { href: "/vscode", label: "VS Code" },
  { href: "/docs", label: "Docs" },
  { href: "/roadmap", label: "Roadmap" },
];

export const docsNav = [
  { href: "/docs", label: "Introduction" },
  { href: "/docs/getting-started", label: "Getting started" },
  { href: "/docs/language", label: "Language core" },
  { href: "/docs/grammar", label: "Grammar" },
  { href: "/docs/profiles", label: "Profiles" },
  { href: "/docs/cli", label: "CLI" },
  { href: "/docs/targets", label: "Targets" },
  { href: "/docs/verification", label: "Verification" },
];
