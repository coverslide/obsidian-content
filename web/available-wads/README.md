# Runtime add-on WADs

Place add-on `.wad` or `.pk3` files in the server's mounted `available-wads/` directory and add an entry to `catalog.json`. This directory is mounted read-only into UZDoom at runtime; add-ons are not copied into the Docker image and do not need an image rebuild.

Each entry has a title, a compatible base IWAD filename (`doom.wad`, `doom2.wad`, `heretic.wad`, or `hexen.wad`), an array of mod filenames to load in order, and a short description. Keep each archive's accompanying readme/license text alongside its WAD files.

`harm1.wad` is a base IWAD and belongs in the base IWAD directory, not here. The catalog includes No Rest for the Living (`nerve.wad`) and Legacy of Rust (`id1.wad`) from the local Steam installation. Legacy of Rust calls for MBF21 support and recommends ID24; UZDoom compatibility may vary for ID24-only effects.
