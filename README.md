# VAULT Workbench

**Plan your drawers. Pick your colors. Know what to print.**

An unofficial, self-hosted companion for the **USSA VAULT** modular storage system.
Use your own purchased files to plan a single drawer or a mixed stack, preview the
assembly, check printer fit and download the original STLs needed for your design.

**Early development preview · Docker / Unraid / Windows · Local processing**

> Bring your own VAULT collection. This repository contains the application, not
> the storage models. No purchased STL files, derived preview meshes, original
> manuals or USSA product images are distributed here.
> Get the collection from [USSA Design](https://www.ussadesign.com/pages/vault).

[Install with Docker](#install-with-docker) · [Unraid / Dockge](#unraid--dockge) ·
[Windows](#windows) · [First build](#your-first-build) ·
[Troubleshooting](#troubleshooting) · [Report a bug](#report-a-bug)

## What you can do

- **One Configurator:** build a single drawer, repeat levels, or place two small
  drawers above a large drawer. Each level can have its own height.
- **Use your actual parts:** generate lightweight previews locally from your
  collection; original STLs remain untouched.
- **Choose the finish:** preview colors for structure, facades, boxes and small
  parts, with light and dark interface themes.
- **Check the printer:** searchable presets, editable build volumes and clearance,
  with fit results for the complete original STL files.
- **Plan filament:** enter sliced grams per complete STL; combine quantities,
  material prices and an optional reserve into a design total.
- **Prepare the print:** combined parts list, hardware quantities, print progress,
  CSV export and a ZIP of the selected original STLs.
- **Keep designs:** browser autosave, named projects and portable JSON plans.
- **Find problems:** resumable preview importing and local diagnostic bundles.

### Current scope

| Area | Supported today |
| --- | --- |
| Drawer assemblies | S, M and L families; depths 3–7; heights 1F, 2F and 4F |
| Layouts | Up to six levels; L width allows one L or two side-by-side S modules |
| Per-level choices | Height, roof, optional internal baseplate and geared rails |
| Shared choices | Depth, color groups, printer and spool settings |
| Other library parts | Individual inspection of imported XL, split-width, sustainer and modification parts |
| Filament | Totals from weights supplied by your slicer; no built-in slicing |

Two S modules on the same level share height and options. Mixed-size positions
are illustrative: nominal width matching does not certify mating features,
transition roofs or mounting hardware. Verify the original parts and assembly
instructions before printing. Printer fit uses a conservative bounding rectangle;
your slicer remains the final check for orientation, brims and excluded bed areas.

## Before you start

You need your purchased collection, a modern browser with WebGL for 3D, and either
Docker Compose or a Windows installation. A first Docker build and Windows setup
need internet to download dependencies; importing and planning then run locally.
Without WebGL, Configurator shows a nominal front layout drawing.

Keep the original collection's folder structure. Select or mount the **parent**
folder, for example:

```text
USSA VAULT/
  VAULT/
    01. DRAWERS/
    ...
  PEGBOARD/
    ...
```

If your purchase contains only VAULT, use its parent folder. Do not point the app
at `01. DRAWERS` or flatten/rename the purchased directories. Restart the app after
adding or replacing original files so it can rescan the inventory.

## Install with Docker

There is currently no prebuilt container image to pull: Compose builds it from
this repository. Install Git, Docker Engine and the Docker Compose plugin first.

```sh
git clone https://github.com/mshrem/vault-workbench.git
cd vault-workbench
cp .env.example .env
```

Edit `.env` with **absolute host paths** and the user/group that should own the
cache. The user/group must be able to read the collection and write to the cache.

```dotenv
VAULT_LIBRARY=/path/to/USSA VAULT
VAULT_CACHE=/path/to/vault-workbench-cache
VAULT_PORT=8787
PUID=1000
PGID=1000
```

Create the cache directory, give the configured user write access, then start:

```sh
docker compose up -d --build
```

Open **`http://YOUR-SERVER-IP:8787`** and follow **Start here**.
The first image build can take a few minutes. For startup errors, inspect:

```sh
docker compose logs --tail=100 vault-workbench
```

The server has no sign-in system. Keep it on a trusted LAN; do not publish its
port directly to the internet.

## Unraid / Dockge

Use a stack named `vault-workbench`. Put the repository files **directly** in:

```text
/mnt/user/appdata/dockge/stacks/vault-workbench/
```

`compose.yaml`, `Dockerfile`, `server.py` and `web/` must be at that level. If you
used GitHub's **Code → Download ZIP**, move the contents of the extracted
`vault-workbench-main` folder there; do not leave an extra nested folder.

Copy `.env.example` to `.env`. A typical Unraid configuration is:

```dotenv
VAULT_LIBRARY=/mnt/user/Media/STL/USSA VAULT
VAULT_CACHE=/mnt/user/appdata/vault-workbench/cache
VAULT_PORT=8787
PUID=99
PGID=100
```

Create the cache directory in the Unraid terminal:

```sh
mkdir -p /mnt/user/appdata/vault-workbench/cache
chown 99:100 /mnt/user/appdata/vault-workbench/cache
```

If your collection uses custom ACLs, ensure UID 99 / GID 100 can read it, or use
the appropriate IDs instead. Deploy the stack in Dockge, or run:

```sh
cd /mnt/user/appdata/dockge/stacks/vault-workbench
docker compose up -d --build
```

Open `http://YOUR-UNRAID-IP:8787`. Use the importer in **Printer & files** to
prepare previews. No GPU passthrough is needed: the server converts meshes on the
CPU, and your browser renders the 3D view.

### Where the space goes

| Data | Location | Included in the Docker image? |
| --- | --- | --- |
| Application and dependencies | Built image | Yes |
| Purchased originals | `VAULT_LIBRARY` → `/library`, read-only | No |
| Preview meshes, measurements and local logs | `VAULT_CACHE` → `/data`, writable | No |
| Designs and named projects | Browser storage for the app address | No |

With the supplied Compose mounts, importing the collection grows the **host cache
folder**, not Unraid's `docker.img`. Preview size varies by mesh complexity and
conversion outcome; allow free space and monitor the cache directory. Place
`VAULT_CACHE` on another writable disk or SSD if preferred.

Back up exported design JSON files as well as the cache. Browser projects are not
stored in appdata and will not move automatically to another browser or app URL.

## Windows

**Already running on Unraid?** Open its address in your Windows browser. You do
not need Python, Docker or a second copy of the previews on that Windows PC.

For a **standalone** Windows instance:

1. Open this repository's **Actions → Build portable Windows app**.
2. Choose a successful `main` build and download its Windows artifact. Artifact
   downloads require a GitHub sign-in and are retained for seven days.
3. Extract the downloaded artifact and the portable ZIP inside it.
4. Keep `VAULTWorkbench.exe` together with `_internal`, then launch the EXE.
5. Choose your original collection's parent folder and import its previews.

The portable app bundles Python; the PC running the finished app does not need a
separate Python installation. The UI opens in your browser. If no successful
build/artifact is available, see [WINDOWS.md](WINDOWS.md) for building from source.
A source ZIP is **not** a compiled EXE. Windows build status is shown in Actions;
a packaged build is usable only after its smoke tests pass. Builds are unsigned.

Standalone cache/settings default to `%LOCALAPPDATA%\VAULTWorkbench`, outside the
EXE folder. It has its own import and listens on `http://localhost:8787` by default.
Keep the console open; Ctrl+C stops the server. See [WINDOWS.md](WINDOWS.md) for
folder changes, alternate ports and full build instructions.

## Your first build

1. **Choose the printer.** Use a preset or enter your usable X/Y/Z volume and
   clearance. For a modified Voron, use the actual configured travel limits.
2. **Connect the files.** Check the accessible inventory in **Printer & files**.
3. **Import previews.** Start with **Drawers · 128 MB · 2 workers**. Stop/resume
   as needed; successful, unchanged previews are reused.
4. **Open Configurator.** Choose **One plain drawer** or **Large + two small**,
   then edit width, depth and the levels. Levels are listed top first.
5. **Customize.** Set each level's height and options, choose colors and open
   the drawers or use the exploded view to inspect the layout.
6. **Review the plan.** Use **Parts**, **Filament** and **Checks** for quantities,
   slicer weights and per-file printer fit. Mark complete STL copies as printed.
7. **Save and download.** Save a project and JSON backup, export the CSV, or
   package the original STLs. Slice the originals using the indicated quantities.

More layout details: [MIXED-LAYOUTS.md](MIXED-LAYOUTS.md).

### Gridfinity: roof versus drawer interior

| Option | Where it belongs |
| --- | --- |
| Gridfinity roof | Outside, on top of the module |
| Flat table roof | A plain top surface |
| Gridfinity baseplate | Inside the drawer, as the grid beneath removable bins |

Roof and interior are independent. **One plain drawer** selects a flat roof and
no internal Gridfinity baseplate. The baseplate option does not add bins; source
those separately. Recent preview placement uses the loaded baseplate's height so
it sits on the drawer floor rather than using the old sample's fixed offset.

### Filament and STL downloads

Enter grams for **one complete STL**, including both pieces when a file contains
a pair. The plan multiplies by the number of complete-file copies. Blank weights
stay unknown; a partial total is not a complete design estimate. Edit names,
prices and colors in **Spool settings**. Re-slice after changing print settings.

A print package contains unchanged original STL bytes, a design manifest and
quantity/filament information. Preview colors do not modify STLs or configure
slicer filaments. Assign materials in your slicer. Packages are limited to
**50 unique files / 600 MB of source bytes**; download individual originals or
split a larger design when needed. Some original STLs need printing supports.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No original files found | Mount/select the parent containing `VAULT`; preserve the purchased structure and check read permissions. Restart after replacing files. |
| Import is slow or the server is busy | Try 1 worker. Large STLs can use several GB of RAM per worker; more workers do not always finish sooner. |
| “Dimensions only” | The file exceeded the selected size limit or remained too complex. Increase the size limit only for size exclusions. Repeating an identical run does not solve mesh complexity. |
| Gray wireframes / missing geometry | Refresh the library after import. Check that the exact required file has a cached preview; the app does not substitute an unrelated part. |
| No 3D view | Check browser WebGL/hardware acceleration. The front drawing is a fallback, not the original mesh. |
| Original can download but has no preview | Expected for some complex files. A printable source and a lightweight preview are separate things. |
| Cache permission error | Check that the configured UID/GID can write to `VAULT_CACHE` and read the collection. |
| A package button is disabled | Check missing catalog/original files and the package limits. Use the displayed reason. |
| Changes are missing after an update | Rebuild the container and hard-refresh the browser with Ctrl+F5. |
| Saved designs disappeared at another URL | Browser storage is scoped to the address. Export a JSON plan at the old address and load it at the new one. |

Previews are simplified and some source meshes contain embedded supports. Not
all imported files can currently produce a usable preview. Verify the complete
original in your slicer before committing to a print.

## Updates and backups

Export important plans first. If installed with Git, pull the latest source,
then rebuild from the same stack directory:

```sh
git pull --ff-only
docker compose up -d --build --force-recreate
```

For a ZIP installation, merge the new repository files into the existing folder,
preserving your `.env`, customized Compose settings and other local configuration,
then rebuild. Keep `VAULT_LIBRARY` and `VAULT_CACHE` pointed at the same locations;
do not clear previews for a normal app update. Hard-refresh afterward.
See [SETUP-UPDATE.md](SETUP-UPDATE.md) for migration notes.

## Report a bug

Open an [issue](https://github.com/mshrem/vault-workbench/issues) with the app
version, installation type, browser, steps to reproduce and the affected
family/depth/height/options. Screenshots are useful when permitted to share.

In **Printer & files → Download support bundle**, export and review the local
report before attaching it. It includes relative part filenames, import statuses,
dependency versions and recent structured events. It excludes model geometry,
absolute library paths and environment variables. Logs rotate at roughly
**3 MB total** in the cache. Nothing is submitted automatically.

**Do not attach purchased STLs, derived preview meshes or original manuals to
public issues.** The bug-report template helps collect the useful details.
See [CONTRIBUTING.md](CONTRIBUTING.md) for development and reporting guidance.

## Development

Use Python 3.12 and Node.js 22 or newer. Runtime browser dependencies are bundled;
Node.js is needed for development checks, not for running the app.

```sh
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-importer.txt
python -m unittest discover -s tests -p 'test_*.py'
npm ci
npm run check
npm test
```

Run from source with your own library:

```sh
python server.py --library "/path/to/USSA VAULT" --open
```

Public geometry tests use synthetic fixtures. They check application behavior
without distributing purchased meshes and do not certify physical assembly fit.
Native Windows packaging is checked by its separate Actions workflow.

## Credits and licensing

VAULT names and storage designs belong to **USSA Design**. This is an independent
community project, not an official configurator or an endorsed USSA release.
Each user supplies their own model collection under its applicable license.

An application source-code license has not yet been selected. This preview does
not claim an open-source license. Three.js retains its MIT notice in
[`web/vendor/LICENSE`](web/vendor/LICENSE); other dependencies retain their own
licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
