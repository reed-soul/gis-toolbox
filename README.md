# GIS Toolbox

**[gis.taoliapp.com](https://gis.taoliapp.com)** — a free, browser-based GIS workbench. Load geospatial data, convert formats, run spatial analysis, and visualize 3D city models — all processed **locally in your browser**. No upload, no signup, no install.

## Highlights

- **Format conversion** — GeoJSON, Shapefile, KML, KMZ, GPX, CSV, WKT, TopoJSON, FlatGeobuf, GeoPackage, GeoParquet, DXF, PMTiles
- **Coordinate conversion** — WGS84, Web Mercator, UTM, 100+ EPSG systems (regional CRS like GCJ-02 / BD-09 available as options)
- **Spatial analysis** — buffer, intersect, union, difference, dissolve, simplify, reproject (Turf-based, in-browser)
- **3D viewers** — OGC 3D Tiles, Google Photorealistic 3D Tiles, ArcGIS I3S, and 3D Gaussian Splatting (.sog / .ply) on a Cesium globe
- **Hyperspectral** — open NetCDF / HDF5 cubes (e.g. NASA EMIT), browse bands, plot spectra, export GeoTIFF — decoded in-browser via WebAssembly
- **Spatial SQL** — query GeoJSON with SQLite-style SQL + spatial functions, powered by DuckDB
- **Vector tiles** — stream remote PMTiles, render million-feature coverages, export PMTiles
- **Workflow builder** — chain operations into reusable local pipelines with share links
- **9 languages** — English, 简体中文, 繁體中文, Deutsch, Español, Français, 日本語, Português, 한국어

## Privacy-first

Files never leave the device. All parsing, conversion, and analysis run client-side (WebAssembly + Web Workers); the site is static-hosted.

## Try it

👉 **[gis.taoliapp.com](https://gis.taoliapp.com)** — open a tool and drop a file.

Feedback and feature requests are welcome in [Issues](https://github.com/reed-soul/gis-toolbox/issues).
