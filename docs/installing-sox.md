# Installing SoX (optional)

SoX is used by VoiceForge for audio post-processing (echo, normalization). VoiceForge works without it, but with SoX you get richer character sound. Install the `sox` binary so it’s on your PATH.

## macOS

Using [Homebrew](https://brew.sh):

```bash
brew install sox
```

## Windows

Choose one of the following:

- **Chocolatey:** `choco install sox`
- **Scoop:** `scoop install sox`
- **Manual:** Download the [SoX Windows binaries](https://sourceforge.net/projects/sox/files/sox/) and add the folder containing `sox.exe` to your PATH.

## Linux

- **Debian / Ubuntu:** `sudo apt install sox`
- **Fedora / RHEL:** `sudo dnf install sox`
- **Arch:** `sudo pacman -S sox`

## Verify

Check that SoX is installed and on your PATH:

```bash
sox --version
```
