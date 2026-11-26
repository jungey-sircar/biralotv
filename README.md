<div align="center">

<img src="assets/images/biralotv-horizontal.png" alt="BiraloTV Logo" width="480" />

### Sleek, Netflix-inspired streaming app for Android & Windows Desktop

[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows%20Desktop-ff5722.svg?style=for-the-badge)](#downloads--releases)
[![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020.svg?style=for-the-badge&logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61dafb.svg?style=for-the-badge&logo=react)](https://reactnative.dev)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848F.svg?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

*Named after "Biralo" (Nepali for Cat 🐱), BiraloTV delivers a cinematic, ad-free streaming entertainment experience with zero logins, zero subscriptions, and seamless cross-platform playback.*

</div>

---

## 🌟 What is BiraloTV?

**BiraloTV** is a free, modern streaming application crafted for movie lovers, binge-watchers, and cord-cutters. Built with **Expo**, **React Native**, and **Electron**, BiraloTV brings the premium feel of Netflix and Apple TV directly to your Android device and Windows PC.

Say goodbye to cluttered interfaces, forced account signups, and broken video links. BiraloTV aggregates high-definition video sources with intelligent multi-server fallback, rich TMDB metadata, and a persistent local library that respects your privacy.

---

## 🎬 What Can You Stream?

BiraloTV provides instant access to a vast, constantly updated entertainment universe:

### 🍿 1. Latest Blockbusters & Trending Movies
* High-definition movies spanning every genre: Action, Sci-Fi, Thrillers, Comedy, Drama, Horror, Romance, and Animation.
* Up-to-the-minute Trending and Top Rated shelves curated from TMDB.
* Comprehensive movie details: trailers, plot synopsis, release dates, age ratings, and full cast lists.

### 📺 2. Full TV Shows & Binge-Worthy Series
* Multi-season TV show browsing with complete season and episode selectors (Season 1..N, Episode 1..N).
* Episode thumbnails, synopses, and seamless episode switching.
* High-res backdrops and poster artwork for every show.

### 🎞️ 3. Free To Watch & Public Domain Classics
* Curated collection of legendary films, golden-age cinema, and vintage favorites sourced from open public domain archives (Internet Archive, Pluto, and free web streams).
* 100% legal, free-forever movies streamable without any setup.

### 📡 4. Live Channels & IPTV
* Stream live television broadcasts and HLS channels smoothly through our optimized video pipeline.

### 💬 5. Multi-Language Subtitles Everywhere
* Integrated subtitle engine with auto-detection for popular movies and shows.
* Search and switch between dozens of languages (English, Spanish, French, German, Hindi, Arabic, and more).
* Interactive subtitle customization: adjust font scale and sync timing (delay offset) on the fly directly inside the player.

---

## ⚡ Key Features

| Feature | Description |
| :--- | :--- |
| **Netflix-Style Hero** | Dynamic cinematic hero banner with backdrop trailers, plot previews, ratings, and instant playback. |
| **Offline Downloads** | Download movies and TV show episodes directly to your Android device or Windows PC to watch offline anytime with zero data usage or buffering. Complete with real-time progress, pause/resume, and storage management. |
| **Persistent Resume Playback** | Remembers your exact watch position down to the second. Automatically resumes where you left off, even across app exits and device reboots. |
| **Local Watchlist & Favorites** | Save movies and series to your personal library with a single tap. All data is saved locally on your device—no sign-in required. |
| **Multi-Server Streaming** | Multi-source stream engine with automatic fallback. If one server is slow or down, effortlessly switch to alternate mirrors in one tap. |
| **Custom Fullscreen Video Player** | Native ExoPlayer on Android (`expo-video`) and high-performance HLS on Desktop (`hls.js`). Supports 10s skip, scrubbing, aspect ratio toggle, and auto-hiding UI. |
| **"See All" Grid Navigation** | Dedicated paginated grid views with genre and category filters for both Movies and TV Shows. |
| **Playful Biralo Mascot** | Signature animated running cat splash screen and custom branding. |

---

## 📱 Supported Platforms

### 🤖 Android
* **Native APK**: Powered by React Native and Expo with ExoPlayer hardware acceleration.
* **Orientation Support**: Full portrait catalog browsing with automatic landscape fullscreen video mode.
* **Background Persistence**: Automatic progress saving when switching apps or locking the screen.

### 💻 Windows Desktop
* **Electron App**: Native Windows installer (`.exe`) and portable standalone application.
* **Hardware Accelerated**: Chromium-backed media rendering with ultra-low latency.
* **Deterministic Storage**: Local library and playback progress permanently isolated and preserved across restarts.

---

## 📦 Downloads & Releases

Pre-built binaries are generated and available in the repository build directories:

* **Android Release APK**: `build-artifacts/biralotv.apk`
* **Windows Installer**: `desktop-build/biralotv-setup.exe`
* **Windows Portable**: `desktop-build/biralotv-portable.exe`

---

## 🛠️ Development & Building

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm** or **bun**
* **Java Development Kit (JDK 17+)** & **Android Studio** (for building Android APK locally)
* **Git**

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/biralotv.git
cd biralotv
npm install
```

### 2. Start the Development Server
```bash
# Start Expo development server (scan QR code in Expo Go or dev client)
npx expo start
```

### 3. Run Android Build Locally
```bash
npx expo run:android
```

### 4. Run Windows Desktop App
```bash
# Export the web bundle and launch Electron
npm run desktop

# Or run the already-exported desktop build directly:
npm run desktop:run
```

### 5. Build Release Packages

#### Build Android Release APK:
```powershell
cd android
.\gradlew.bat assembleRelease
# Output will be located at:
# android/app/build/outputs/apk/release/app-release.apk
```

#### Package Windows Desktop Executable:
```bash
npm run desktop:build
# Executables generated in desktop-build/
```

---

## 📁 Project Architecture

```
biralotv/
├── assets/images/          # Logos, icons, banners, and cat splash animations
├── src/
│   ├── app/                # Expo Router file-based screens
│   │   ├── index.tsx       # Main Home screen (Hero, shelves, categories)
│   │   ├── vod-detail.tsx  # Movie & TV Show details modal
│   │   ├── player.tsx      # Fullscreen media player & subtitle controller
│   │   ├── on-demand.tsx   # "See All" catalog browser & genre filters
│   │   ├── favorites.tsx   # Watchlist & Continue Watching manager
│   │   ├── downloads.tsx   # Offline downloads manager & playback
│   │   └── settings.tsx    # App preferences, server endpoints & subtitles
│   ├── components/         # Reusable UI components
│   │   ├── netflix-hero.tsx            # Cinematic hero carousel
│   │   ├── continue-watching-row.tsx   # Saved progress shelf
│   │   ├── vod-card.tsx & vod-row.tsx  # Poster cards and horizontal carousels
│   │   ├── stream-player.tsx           # Native Android video player
│   │   └── stream-player.web.tsx       # Desktop/Web HTML5 & HLS player
│   └── lib/                # Core utilities, state & APIs
│       ├── store.ts        # Zustand store (Favorites & Continue Watching)
│       ├── downloads.ts    # Cross-platform download engine & offline manager
│       ├── tmdb.ts         # The Movie Database API integration
│       ├── subtitles.ts    # Multi-language subtitle parser & search
│       └── scraper.ts      # Multi-server stream resolvers
├── desktop/                # Electron main process and local proxy daemon
├── desktop-build/          # Compiled Windows binaries (setup & portable)
└── build-artifacts/        # Android APK release builds
```

---

## 🔒 Privacy & Legal Disclaimer

* **BiraloTV does not host or store any video media files on its servers.**
* All video content, trailers, and streams are aggregated from third-party public APIs, public domain archives (e.g. Internet Archive), and external media indexers.
* Metadata and posters are provided by [The Movie Database (TMDB)](https://www.themoviedb.org/), but BiraloTV is not officially endorsed or certified by TMDB.
* BiraloTV does not collect personal data, track user viewing habits, or require accounts. All favorites, history, and watch positions are stored exclusively on your local device.

---

<div align="center">
  <sub>Crafted with ❤️ and 🐱 by the BiraloTV team. Enjoy streaming!</sub>
</div>
