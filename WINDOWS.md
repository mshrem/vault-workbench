# VAULT Workbench on Windows

## Use the existing Unraid app

Open `http://YOUR-UNRAID-IP:8787` in a Windows browser on the same network.
This uses the server's originals and previews. Windows needs no Python, Docker,
or second preview import. You can create a browser shortcut to that address.

## Standalone portable EXE

This source download contains a Windows build kit, **not a compiled Windows EXE**.
The build must run on Windows. The resulting portable app bundles Python and the
importer dependencies, so the computer running it needs no Python installation.
The interface still opens in your browser.

On a Windows build PC with **64-bit Python 3.12**, including Tcl/Tk, and internet:

1. Extract this entire download to a writable folder.
2. Double-click `build-windows.cmd`.
3. Wait for dependency installation, packaging and packaged-app smoke tests.
4. Find `dist/VAULTWorkbench-Windows-x64.zip`.

Alternatively, the included `.github/workflows/windows-build.yml` can build it
on GitHub's Windows runner: place these source files at a repository's root,
run **Build portable Windows app** from Actions, and download the resulting
artifact. The public source package includes no licensed sample models or manuals.

The builder fails if the packaged native extensions, isolated converter,
HTTP assets, Unicode filenames or external preview cache smoke test fails.
The Windows EXE and Windows build script have **not yet been run in this Linux
development environment**. Source/launcher checks here do not replace that test.

## Run the finished portable app

1. Extract the **whole** finished ZIP. Keep `VAULTWorkbench.exe` together with
   its `_internal` folder; copying the EXE alone will not work.
2. Double-click `VAULTWorkbench.exe`.
3. On first launch, choose the originals folder containing `VAULT` and `PEGBOARD`.
   The folder stays where it is; originals are read only.
4. Keep the console window open while using the app. Press Ctrl+C there to stop.
   Closing the browser tab leaves the local server running.

The folder choice is remembered. To select a different library, stop the app
and use `Choose-original-folder.cmd`, or run:

```powershell
.\VAULTWorkbench.exe --choose-library
```

Cache and launcher settings default to `%LOCALAPPDATA%\VAULTWorkbench`, outside
the portable folder. `VAULT_DATA` can select another writable cache directory.
No originals or generated previews are added to the EXE or portable ZIP.
This public package includes no USSA sample geometry or manuals.

A standalone Windows instance has its own cache and requires its own import.
Do not copy the live Unraid cache into it while an import is running; the cache
is keyed to the original folder's absolute path. Use the Unraid URL to share the
existing cache. Saved browser designs are also tied to the app's address; export
them as JSON and import them at the other address when moving between instances.

The app listens on localhost only. Its default address is `http://localhost:8787`.
If that port is occupied, close the other local copy, or run with `--port 8788`.
