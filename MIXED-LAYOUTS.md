# Configurator guide

One Configurator handles a single drawer, uniform stacks and mixed S/L layouts.
It autosaves the current draft in this browser. Use **Save project** for a named
copy and **Save plan** for a portable JSON backup. My projects opens both previous
single-size projects and new mixed designs. Load plan also accepts older plans.

## Starting points

- **One plain drawer:** one 1F drawer, flat table roof, no internal baseplate or
  geared rails. It uses the selected footprint/depth and current colors/settings.
- **Large + two small:** an L drawer below a pair of S drawers. Edit each level
  to choose the height and options you need.
- **Restore previous drawer build:** explicitly import the older single-size
  draft when migrating from a previous version.

Starting points replace the current draft. Undo restores the preceding edit.
An existing current layout takes priority over templates on reopening the app.
Older role-based slicer weights must be re-entered as file-specific weights;
new mixed-plan weights and printed counts survive JSON/project round trips.

## Levels

Levels are listed **top first**. Select one to edit its layout, height, roof,
interior, rails and name. Use Move up/down, Duplicate, Remove and Undo. You can
also select a module in the 3D view. The limit is six levels.

S and M footprints support one matching module per level. L supports one L or
two S modules. Both S modules on one level share height and options; every level
shares depth. Heights are 1F, 2F or 4F. Displayed stack pitch excludes fit details.

Only selected roofs appear in the parts list. Nominal width matching alone does
not establish mechanical compatibility: check original mating features, roof
choices, connectors and stability using your purchased instructions and parts.
Sustainers, XL and split-width modules currently support individual inspection.

## Inside and outside

The Gridfinity roof is the grid **on top**. The optional Gridfinity baseplate
belongs **inside** the drawer, under separately sourced bins. These are independent
choices; switching the insert off does not remove the roof. New rows start with
no internal insert. Open the drawers to inspect it when 3D is available.

Baseplate placement uses the loaded mesh's actual height so taller imported
variants sit on the drawer floor. Cached previews and source STLs are unchanged.
Previews still use illustrative assembly anchors; review the originals in a slicer.

## Parts, filament and printing

Identical original STL identities are combined across levels. Paired-piece STLs
count as a complete file. Use the checkbox to mark every required copy printed,
or enter a partial copy count. The manifest/CSV carry required quantities.

Enter slicer grams per complete STL in Filament. Totals multiply by copies;
missing weights remain visibly incomplete. Spool prices, colors and the printer
can be edited in the Workshop pages and update the active plan. Checks evaluates
the complete original files, rather than testing the size of the assembled tower.

STL packages contain unchanged originals and the design plan. The limit is 50
unique files and 600 MB of source bytes. Individual downloads are available for
larger designs. Colors are supplied as plan information; assign them in the slicer.

Missing previews use gray wireframes. Missing catalog files block incomplete
exports. A browser without WebGL displays a nominal front drawing instead of 3D.
