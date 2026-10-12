#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bundle_path="${1:-src-tauri/target/release/bundle/macos/MDB.app}"
version="$(node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json')).version;
const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json')).version;
const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || version !== tauriVersion || version !== cargoVersion) {
  throw new Error('Package, Cargo and Tauri versions must match.');
}
console.log(version);
NODE
)"
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$bundle_path/Contents/Info.plist")" != "$version" ]]; then
  echo 'Application version does not match source version.' >&2
  exit 1
fi
if [[ "$(lipo -archs "$bundle_path/Contents/MacOS/mdb")" != 'arm64' ]]; then
  echo 'The release archive requires a macOS arm64 application.' >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$bundle_path"

mkdir -p release
package_scratch="$(mktemp -d)"
trap 'rm -rf "$package_scratch"' EXIT
archive="MDB-${version}-macos-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$bundle_path" "$package_scratch/$archive"
cp LICENSE "$package_scratch/LICENSE"
(cd "$package_scratch" && zip -q "$archive" LICENSE)
ditto -x -k "$package_scratch/$archive" "$package_scratch/extracted"
cmp LICENSE "$package_scratch/extracted/LICENSE"
codesign --verify --deep --strict --verbose=2 "$package_scratch/extracted/MDB.app"
mv "$package_scratch/$archive" "release/$archive"
(cd release && shasum -a 256 "$archive" > SHA256SUMS)
checksum="$(awk '{print $1}' release/SHA256SUMS)"
cat > release/mdb.rb <<CASK
cask "mdb" do
  version "$version"
  sha256 "$checksum"

  url "https://github.com/myersguo/mdb/releases/download/v#{version}/MDB-#{version}-macos-arm64.zip"
  name "MDB"
  desc "Desktop database client for MySQL and SQLite"
  homepage "https://github.com/myersguo/mdb"

  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "MDB.app"

  zap trash: [
    "~/Library/Application Support/com.myersguo.mdb",
    "~/Library/Caches/com.myersguo.mdb",
    "~/Library/Preferences/com.myersguo.mdb.plist",
    "~/Library/WebKit/com.myersguo.mdb",
  ]

  caveats <<~EOS
    MDB is ad-hoc signed, but not Developer ID signed or notarized.
    macOS may require approval in Privacy & Security on first launch.
  EOS
end
CASK
printf 'Verified release: release/%s\n' "$archive"
