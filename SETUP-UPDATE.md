# Setup, updates and migration

Start with the installation instructions in [README.md](README.md). The local
**Start here** page links printer settings, original-folder connection, preview
importing and the Configurator. Do not open `index.html` directly from disk.

## Updating an existing Docker / Unraid installation

1. Finish or stop an active import and export important designs to JSON.
2. Keep your existing original-library and preview-cache paths.
3. Update the app source using Git, or merge the current repository files into
   the existing stack folder. Preserve `.env` and custom Compose configuration.
4. Rebuild from the folder containing `compose.yaml`:

```sh
docker compose up -d --build --force-recreate
```

5. Hard-refresh the browser with Ctrl+F5.

You do not need to delete previews or import the entire collection again for an
interface update. Original files remain read-only. The converter can retry
outdated records when its revision changes; unchanged successful previews are
reused. Changing the original folder's absolute path creates a separate cache
namespace, so retain the mount path when moving to this repository.

## Moving from earlier Workbench builds

- Single-size and mixed designs now open in **one Configurator**. Existing named
  projects remain in the same browser's My projects list.
- The previous single-size draft is preserved and can be restored explicitly.
- Save/load JSON lets you move designs between browsers or addresses. Browser
  storage is scoped to the app URL; an appdata backup alone does not save it.
- Older role-based slicer weights need to be entered against individual files in
  the combined plan. Current mixed-plan weights and print progress are retained.
- Spool settings edit materials/prices; the Filament tab in Configurator is the
  place to enter weights and see the current design total.
- Recent baseplate placement follows the loaded preview height. There is no
  converter/cache reset needed for that display correction.

The public repository contains no licensed previews or manuals. A first-time
public install must import its own models. An installation already holding a
compatible cache can keep using it at its existing source path.

## Backups

Keep the purchased originals, exported plan JSON files and any local configuration.
The preview cache is reproducible but may take substantial time to regenerate;
back it up when useful. Stop imports before making a cache copy. On Windows,
launcher settings and cache default to `%LOCALAPPDATA%\VAULTWorkbench`.
