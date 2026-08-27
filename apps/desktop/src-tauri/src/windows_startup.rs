use std::collections::HashMap;

use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

#[derive(Debug)]
struct ProcessIdentity {
    pid: u32,
    parent_pid: u32,
    executable: String,
}

pub fn codex_process_is_running(halo_pid: u32) -> bool {
    let processes = process_identities();
    let parents = processes
        .iter()
        .map(|process| (process.pid, process.parent_pid))
        .collect::<HashMap<_, _>>();
    processes.iter().any(|process| {
        is_relevant_codex_executable(&process.executable)
            && !is_descendant_of(process.pid, halo_pid, &parents)
    })
}

fn process_identities() -> Vec<ProcessIdentity> {
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return Vec::new();
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let name_end = entry
                .szExeFile
                .iter()
                .position(|character| *character == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..name_end]);
            let executable = if name.eq_ignore_ascii_case("codex.exe") {
                process_executable(entry.th32ProcessID).unwrap_or_default()
            } else {
                String::new()
            };
            processes.push(ProcessIdentity {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
                executable,
            });
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    processes
}

fn process_executable(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..length as usize]))
}

fn is_descendant_of(pid: u32, ancestor: u32, parents: &HashMap<u32, u32>) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        let Some(parent) = parents.get(&current).copied() else {
            return false;
        };
        if parent == ancestor {
            return true;
        }
        if parent == 0 || parent == current {
            return false;
        }
        current = parent;
    }
    false
}

fn is_relevant_codex_executable(path: &str) -> bool {
    let components = std::path::Path::new(path)
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    let is_codex = components.last().is_some_and(|name| name == "codex.exe");
    let is_vscode_extension = components.iter().any(|component| component == ".vscode")
        && components
            .iter()
            .any(|component| component.starts_with("openai.chatgpt-"))
        && components
            .iter()
            .any(|component| component == "windows-x86_64");
    let is_desktop_install = components.windows(3).any(|parts| {
        parts[0] == "openai" && parts[1] == "codex" && parts[2] == "bin"
    });
    let is_official_npm_package = components.windows(2).any(|parts| {
        parts[0] == "@openai"
            && (parts[1] == "codex" || parts[1].starts_with("codex-win32-"))
    });
    let has_native_vendor_layout = components.windows(4).any(|parts| {
        parts[0] == "vendor"
            && (parts[1] == "x86_64-pc-windows-msvc"
                || parts[1] == "aarch64-pc-windows-msvc")
            && (parts[2] == "bin" || parts[2] == "codex")
            && parts[3] == "codex.exe"
    });
    let is_npm_cli = is_official_npm_package && has_native_vendor_layout;
    is_codex && (is_vscode_extension || is_desktop_install || is_npm_cli)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_verified_codex_install_identities() {
        assert!(is_relevant_codex_executable(
            r"C:\Users\Person\.vscode\extensions\openai.chatgpt-1.2.3-win32-x64\bin\windows-x86_64\codex.exe"
        ));
        assert!(is_relevant_codex_executable(
            r"C:\Users\Person\AppData\Local\OpenAI\Codex\bin\version\codex.exe"
        ));
        assert!(is_relevant_codex_executable(
            r"C:\Users\Person\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
        ));
        assert!(is_relevant_codex_executable(
            r"C:\Users\Person\AppData\Roaming\npm\node_modules\@openai\codex\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
        ));
    }

    #[test]
    fn rejects_unrelated_or_helper_processes() {
        assert!(!is_relevant_codex_executable(r"C:\Tools\codex.exe"));
        assert!(!is_relevant_codex_executable(
            r"C:\Users\Person\AppData\Local\OpenAI\Codex\bin\version\codex-code-mode-host.exe"
        ));
    }

    #[test]
    fn excludes_processes_spawned_by_codexhalo() {
        let parents = HashMap::from([(30, 20), (20, 10), (10, 1)]);
        assert!(is_descendant_of(30, 10, &parents));
        assert!(!is_descendant_of(30, 99, &parents));
    }

    #[test]
    fn process_identity_scan_stays_lightweight() {
        let started = std::time::Instant::now();
        for _ in 0..20 {
            let _ = codex_process_is_running(std::process::id());
        }
        let elapsed = started.elapsed();
        eprintln!("20 process-identity scans: {elapsed:?}");
        assert!(elapsed < std::time::Duration::from_secs(5));
    }
}
