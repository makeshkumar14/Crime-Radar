# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Google Maps Integration

The 2D operations view can now use the official Google Maps JavaScript API, and the
Travel Safety Advisor can use Google road directions plus geocoding for safer-drive routing.

1. Create a Google Cloud project.
2. Enable the Maps JavaScript API.
3. Enable the Directions API or Directions API (Legacy), depending on your project setup.
4. Enable the Geocoding API.
5. Enable billing for that project.
6. Copy `frontend/.env.example` to `frontend/.env`.
7. Set `VITE_GOOGLE_MAPS_API_KEY` to your key.
8. Start the frontend with `npm run dev`.

If the key is missing, the app falls back to the existing Leaflet/OpenStreetMap view automatically.
