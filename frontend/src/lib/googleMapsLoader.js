let googleMapsPromise;

export function loadGoogleMapsApi(apiKey) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser."));
  }

  if (!apiKey) {
    return Promise.reject(new Error("Missing Google Maps API key."));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[data-google-maps-loader="crime-radar"]',
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.google?.maps) {
          resolve(window.google.maps);
        } else {
          reject(new Error("Google Maps script loaded without the Maps namespace."));
        }
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Google Maps script failed to load."));
      });
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "crime-radar";

    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps script loaded without the Maps namespace."));
      }
    };

    script.onerror = () => {
      reject(new Error("Google Maps script failed to load."));
    };

    document.head.appendChild(script);
  }).catch((error) => {
    googleMapsPromise = undefined;
    throw error;
  });

  return googleMapsPromise;
}
