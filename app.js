import subprocess
import shutil
import sys


# =========================================================
# PATH SETTINGS
# =========================================================
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "DEM"
TEMP_DIR = BASE_DIR / "build"
VIEWER_TILE_DIR = BASE_DIR / "viewer_docs" / "tiles"

# Input rasters
VIEWSHED_INPUT = DATA_DIR / "viewshed_mosaic_reduced.tif"
LIGHT_INPUT = DATA_DIR / "light_from_wall.tif"

# Zoom settings
MIN_ZOOM = 10
MAX_ZOOM = 14

# =========================================================
# SCALING SETTINGS
# =========================================================
# Leave as None to auto-detect.
# If the viewshed is binary, you may prefer:
# VIEWSHED_SCALE_MIN = 0
# VIEWSHED_SCALE_MAX = 1
VIEWSHED_SCALE_MIN = None
VIEWSHED_SCALE_MAX = None

# Light raster rules:
# 0 should be bright yellow
# 15754 should be darkest blue
# 15755 and above should be transparent
LIGHT_SCALE_MIN = 0
LIGHT_SCALE_MAX = 15754
LIGHT_TRANSPARENT_AT_OR_ABOVE = 15755

# =========================================================
# CLEANUP
# =========================================================
DELETE_TEMP_FILES = False


def run_command(cmd: list[str], label: str) -> str:
    print(f"\n--- {label} ---")
    print(" ".join(str(c) for c in cmd))

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.stdout:
        print(result.stdout)

    if result.returncode != 0:
        if result.stderr:
            print(result.stderr)
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")

    if result.stderr:
        print(result.stderr)

    return result.stdout


def check_dependency(executable_name: str) -> None:
    if shutil.which(executable_name) is None:
        raise EnvironmentError(
            f"Required executable not found in PATH: {executable_name}\n"
            f"Make sure GDAL is installed and available in your active conda environment."
        )


def safe_delete_file(path: Path) -> None:
    if path.exists():
        path.unlink()


def safe_delete_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def get_raster_min_max(src: Path) -> tuple[float, float]:
    cmd = ["gdalinfo", "-mm", str(src)]
    output = run_command(cmd, f"Computing raster min/max for {src.name}")

    min_val = None
    max_val = None

    for line in output.splitlines():
        line = line.strip()
        if "Computed Min/Max=" in line:
            part = line.split("Computed Min/Max=")[-1]
            vals = part.split(",")
            if len(vals) == 2:
                min_val = float(vals[0])
                max_val = float(vals[1])
                break

    if min_val is None or max_val is None:
        raise RuntimeError(f"Could not parse raster min/max from gdalinfo output for {src.name}")

    print(f"Detected raster min/max for {src.name}: {min_val}, {max_val}")
    return min_val, max_val


def reproject_to_3857(src: Path, dst: Path) -> None:
    safe_delete_file(dst)

    cmd = [
        "gdalwarp",
        "-t_srs", "EPSG:3857",
        "-r", "near",
        "-of", "GTiff",
        str(src),
        str(dst),
    ]
    run_command(cmd, f"Reprojecting {src.name} to EPSG:3857")


def convert_to_byte_raster(src: Path, dst: Path, scale_min: float, scale_max: float) -> None:
    safe_delete_file(dst)

    cmd = [
        "gdal_translate",
        "-of", "GTiff",
        "-ot", "Byte",
        "-scale", str(scale_min), str(scale_max), "0", "255",
        str(src),
        str(dst),
    ]
    run_command(cmd, f"Converting {src.name} to 8-bit GeoTIFF")


def convert_light_to_byte_with_transparency(
    src: Path,
    dst: Path,
    threshold: float,
    max_valid_value: float
) -> None:
    """
    Convert light raster directly to Byte while reserving 255 for transparent NoData.

    Output mapping:
    - 0 .. max_valid_value  -> 0 .. 254
    - values >= threshold   -> 255 (NoData / transparent)
    """
    safe_delete_file(dst)

    cmd = [
        sys.executable,
        "-m",
        "osgeo_utils.gdal_calc",
        "-A", str(src),
        "--calc", f"where(A>={threshold},255,round((A/{max_valid_value})*254))",
        "--outfile", str(dst),
        "--NoDataValue", "255",
        "--type", "Byte",
        "--format", "GTiff",
        "--creation-option", "COMPRESS=LZW",
        "--overwrite",
    ]
    run_command(cmd, f"Converting {src.name} to byte with transparency cutoff at {threshold}")


def write_viewshed_color_ramp(dst: Path) -> None:
    safe_delete_file(dst)

    ramp_text = """\
0   0 0 0 0
1   0 255 255 140
64  0 220 255 180
128 120 120 255 220
192 255 80 220 245
255 255 0 160 255
nv  0 0 0 0
"""
    dst.write_text(ramp_text, encoding="utf-8")
    print(f"\n--- Writing viewshed color ramp ---")
    print(f"Saved: {dst}")


def write_light_color_ramp(dst: Path) -> None:
    """
    0 = bright yellow
    254 = darkest blue
    255 is reserved as NoData/transparent and is not included in the ramp
    """
    safe_delete_file(dst)

    ramp_text = """\
0   255 245 0 255
32  250 235 110 250
64  230 225 170 245
96  190 215 220 235
128 140 190 245 225
160 95 155 240 215
192 60 115 220 205
224 35 70 170 195
254 15 25 100 185
nv  0 0 0 0
"""
    dst.write_text(ramp_text, encoding="utf-8")
    print(f"\n--- Writing light color ramp ---")
    print(f"Saved: {dst}")


def apply_color_relief(src: Path, color_file: Path, dst: Path) -> None:
    safe_delete_file(dst)

    cmd = [
        "gdaldem",
        "color-relief",
        str(src),
        str(color_file),
        str(dst),
        "-alpha",
    ]
    run_command(cmd, f"Applying color relief to {src.name}")


def build_xyz_tiles(src_color: Path, tile_dir: Path, min_zoom: int, max_zoom: int) -> None:
    safe_delete_dir(tile_dir)
    tile_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "osgeo_utils.gdal2tiles",
        "--xyz",
        "--webviewer", "none",
        "--no-kml",
        "-z", f"{min_zoom}-{max_zoom}",
        "--processes=1",
        str(src_color),
        str(tile_dir),
    ]
    run_command(cmd, f"Building XYZ tiles for {src_color.name}")


def report_tile_count(tile_dir: Path) -> None:
    png_tiles = list(tile_dir.rglob("*.png"))
    tile_count = len(png_tiles)

    print(f"\nPNG tile count in {tile_dir.name}: {tile_count}")
    if tile_count > 0:
        for p in png_tiles[:5]:
            print(f"  {p}")


def process_raster(
    input_raster: Path,
    layer_name: str,
    scale_min: float | None,
    scale_max: float | None,
    ramp_writer,
    transparent_at_or_above: float | None = None,
) -> None:
    if not input_raster.exists():
        raise FileNotFoundError(f"Input raster not found: {input_raster}")

    raster_3857 = TEMP_DIR / f"{layer_name}_3857.tif"
    raster_byte = TEMP_DIR / f"{layer_name}_3857_byte.tif"
    raster_color = TEMP_DIR / f"{layer_name}_3857_color.tif"
    ramp_file = TEMP_DIR / f"{layer_name}_color_ramp.txt"
    output_tile_dir = VIEWER_TILE_DIR / layer_name

    safe_delete_file(raster_3857)
    safe_delete_file(raster_byte)
    safe_delete_file(raster_color)
    safe_delete_file(ramp_file)

    reproject_to_3857(input_raster, raster_3857)

    if layer_name == "light_from_wall":
        convert_light_to_byte_with_transparency(
            raster_3857,
            raster_byte,
            threshold=LIGHT_TRANSPARENT_AT_OR_ABOVE,
            max_valid_value=LIGHT_SCALE_MAX
        )
    else:
        source_for_scaling = raster_3857

        if scale_min is None or scale_max is None:
            detected_min, detected_max = get_raster_min_max(source_for_scaling)
            scale_min = detected_min if scale_min is None else scale_min
            scale_max = detected_max if scale_max is None else scale_max

        if scale_min == scale_max:
            raise RuntimeError(
                f"{layer_name}: raster min and max are the same ({scale_min}). "
                f"Set scale values manually."
            )

        convert_to_byte_raster(source_for_scaling, raster_byte, scale_min, scale_max)

    ramp_writer(ramp_file)
    apply_color_relief(raster_byte, ramp_file, raster_color)
    build_xyz_tiles(raster_color, output_tile_dir, MIN_ZOOM, MAX_ZOOM)
    report_tile_count(output_tile_dir)

    if DELETE_TEMP_FILES:
        safe_delete_file(raster_3857)
        safe_delete_file(raster_byte)
        safe_delete_file(raster_color)
        safe_delete_file(ramp_file)

    print(f"\n✓ Finished tiles for {layer_name}: {output_tile_dir}")


def main() -> None:
    print(f"Current working directory: {Path.cwd()}")
    print(f"Base dir: {BASE_DIR.resolve()}")
    print(f"Data dir: {DATA_DIR.resolve()}")
    print(f"Tile output dir: {VIEWER_TILE_DIR.resolve()}")

    check_dependency("gdalwarp")
    check_dependency("gdalinfo")
    check_dependency("gdal_translate")
    check_dependency("gdaldem")

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    VIEWER_TILE_DIR.mkdir(parents=True, exist_ok=True)

    process_raster(
        input_raster=VIEWSHED_INPUT,
        layer_name="viewshed",
        scale_min=VIEWSHED_SCALE_MIN,
        scale_max=VIEWSHED_SCALE_MAX,
        ramp_writer=write_viewshed_color_ramp,
    )

    process_raster(
        input_raster=LIGHT_INPUT,
        layer_name="light_from_wall",
        scale_min=LIGHT_SCALE_MIN,
        scale_max=LIGHT_SCALE_MAX,
        ramp_writer=write_light_color_ramp,
        transparent_at_or_above=LIGHT_TRANSPARENT_AT_OR_ABOVE,
    )

    print("\n✓ All raster tile builds complete.")


if __name__ == "__main__":
    main()