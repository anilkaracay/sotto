//! The hard limits of docs/05-ONCHAIN-PROGRAM.md section 1, read from the source and the IDL (section
//! 7: "The program has no instruction that references a token program in a CPI"): every cross
//! program call goes through `invoke_system`, which refuses any program but the System Program; the
//! source builds no Token or Token-2022 instruction and never writes the token account; the IDL's
//! instructions name no token program, pass the token account read only, and name no program account
//! but the System Program. The runtime side (only System Program calls in a verification, the token
//! account unchanged) is in `tests/verify.rs`.

use std::{fs, path::Path};

const SOURCE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
const IDL: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/idl/sotto_proofs.json");
const TOKEN_PROGRAMS: [&str; 2] = [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";

fn sources() -> Vec<(String, String)> {
    let mut files = Vec::new();
    for entry in fs::read_dir(Path::new(SOURCE)).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push((
                path.display().to_string(),
                fs::read_to_string(&path).unwrap(),
            ));
        }
    }
    assert!(files.len() >= 4, "the program's source files");
    files
}

/// The body of `fn name` in `source`, from its signature to its closing brace at column 0.
fn function_body<'a>(source: &'a str, name: &str) -> &'a str {
    let start = source
        .find(&format!("fn {name}("))
        .unwrap_or_else(|| panic!("fn {name}"));
    let end = source[start..].find("\n}\n").unwrap() + start;
    &source[start..end]
}

#[test]
fn every_cross_program_call_goes_through_invoke_system_which_accepts_only_the_system_program() {
    let mut calls = 0;
    for (path, source) in sources() {
        for pattern in [
            "solana_cpi::",
            "invoke_signed",
            "invoke_unchecked",
            "sol_invoke",
        ] {
            for (index, _) in source.match_indices(pattern) {
                let inside = source[..index]
                    .rfind("fn invoke_system(")
                    .is_some_and(|start| {
                        let body = function_body(&source[start..], "invoke_system");
                        index < start + body.len()
                    });
                assert!(inside, "{path}: {pattern} outside invoke_system");
                calls += 1;
            }
        }
        if path.ends_with("processor.rs") {
            let body = function_body(&source, "invoke_system");
            let guard = body
                .find("if instruction.program_id != solana_system_interface::program::ID")
                .expect("the System Program guard");
            assert!(
                guard < body.find("solana_cpi::").unwrap(),
                "the guard comes first"
            );
        }
    }
    assert!(calls > 0);
}

#[test]
fn builds_no_token_instruction_and_never_writes_the_token_account() {
    for (path, source) in sources() {
        for forbidden in [
            "spl_token_2022_interface::instruction",
            "spl_token_interface",
            "spl_token::",
            "confidential_transfer::instruction",
            "token_account.try_borrow_mut",
            "token_account.assign",
            "token_account.resize",
            "set_authority",
            "TOKEN_PROGRAM",
        ] {
            assert!(!source.contains(forbidden), "{path} contains {forbidden}");
        }
        for token_program in TOKEN_PROGRAMS {
            assert!(
                !source.contains(token_program),
                "{path} names {token_program}"
            );
        }
    }
}

/// Every node of the IDL of `kind`, depth first.
fn nodes<'a>(value: &'a serde_json::Value, kind: &str, out: &mut Vec<&'a serde_json::Value>) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("kind").and_then(|k| k.as_str()) == Some(kind) {
                out.push(value);
            }
            map.values().for_each(|child| nodes(child, kind, out));
        }
        serde_json::Value::Array(items) => items.iter().for_each(|child| nodes(child, kind, out)),
        _ => {}
    }
}

#[test]
fn the_idl_names_no_token_program_and_passes_the_token_account_read_only() {
    let text = fs::read_to_string(IDL).unwrap();
    for token_program in TOKEN_PROGRAMS {
        assert!(
            !text.contains(token_program),
            "the IDL names {token_program}"
        );
    }
    let idl: serde_json::Value = serde_json::from_str(&text).unwrap();
    // Every fixed address in the IDL is the System Program's, the default of `systemProgram`.
    let mut fixed = Vec::new();
    nodes(&idl, "publicKeyValueNode", &mut fixed);
    assert_eq!(
        fixed.len(),
        2,
        "initializeConfig and verifyBalanceThreshold name the System Program"
    );
    for value in fixed {
        assert_eq!(value["publicKey"], SYSTEM_PROGRAM);
    }
    let mut accounts = Vec::new();
    nodes(&idl, "instructionAccountNode", &mut accounts);
    for account in &accounts {
        let name = account["name"].as_str().unwrap();
        assert!(
            !name.to_lowercase().contains("tokenprogram"),
            "an account {name}"
        );
        if name.ends_with("Program") {
            assert_eq!(name, "systemProgram");
        }
    }
    // The token account of verifyBalanceThreshold is neither writable nor a signer.
    let token = accounts
        .iter()
        .find(|account| account["name"] == "tokenAccount")
        .unwrap();
    assert_eq!(token["isWritable"], false);
    assert_eq!(token["isSigner"], false);
}
