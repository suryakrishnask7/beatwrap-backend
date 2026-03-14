import os

# Config
ROOT_DIR = "."  # Change to your project root path
OUTPUT_FILE = "beatwrap_codebase.txt"

EXCLUDE_DIRS = {
    "node_modules", ".git", ".expo", "dist", "build",
    "__pycache__", ".cache", "coverage", ".idea", ".vscode"
}

INCLUDE_EXTENSIONS = {
    ".js", ".jsx", ".ts", ".tsx", ".json", ".env",
    ".md", ".html", ".css", ".sh", ".yaml", ".yml"
}

# Exclude these specific files
EXCLUDE_FILES = {"package-lock.json", "yarn.lock"}

def extract_code(root_dir, output_file):
    with open(output_file, "w", encoding="utf-8") as out:
        for dirpath, dirnames, filenames in os.walk(root_dir):
            # Prune excluded dirs in-place
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDE_DIRS and not d.startswith(".")
            ]

            for filename in sorted(filenames):
                if filename in EXCLUDE_FILES:
                    continue
                _, ext = os.path.splitext(filename)
                if ext not in INCLUDE_EXTENSIONS:
                    continue

                filepath = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(filepath, root_dir)

                out.write(f"\n{'='*60}\n")
                out.write(f"FILE: {rel_path}\n")
                out.write(f"{'='*60}\n")

                try:
                    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                        out.write(f.read())
                except Exception as e:
                    out.write(f"[ERROR reading file: {e}]\n")

    print(f"Done! Saved to: {output_file}")

extract_code(ROOT_DIR, OUTPUT_FILE)