/**
 * itm.js — WGS84 (EPSG:4326) → ITM (EPSG:2157) coordinate conversion.
 *
 * Irish Transverse Mercator constants (GRS80 ellipsoid):
 *   Central meridian:  -8° (8°W)
 *   Scale factor:       0.999820
 *   False Easting:      600,000 m
 *   False Northing:     750,000 m
 *   Latitude of origin: 53.5° N
 */

const A = 6378137.0;                   // GRS80 semi-major axis (m)
const F = 1 / 298.257222101;           // GRS80 flattening
const B = A * (1 - F);                 // semi-minor axis
const E2 = 1 - (B * B) / (A * A);     // eccentricity squared
const E = Math.sqrt(E2);

const K0  = 0.999820;                  // scale factor
const LAT0 = 53.5 * Math.PI / 180;    // latitude of origin (rad)
const LON0 = -8.0 * Math.PI / 180;    // central meridian (rad)
const FE  = 600000;                    // false easting (m)
const FN  = 750000;                    // false northing (m)

function meridianArc(lat) {
    const n = (A - B) / (A + B);
    const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
    return A / (1 + n) * (
        (1 + n2 / 4 + n4 / 64) * lat
        - (3 / 2 * (n - n3 / 8)) * Math.sin(2 * lat)
        + (15 / 16 * (n2 - n4 / 4)) * Math.sin(4 * lat)
        - (35 / 48 * n3) * Math.sin(6 * lat)
        + (315 / 512 * n4) * Math.sin(8 * lat)
    );
}

/**
 * Convert WGS84 decimal degrees to ITM Easting/Northing.
 * @param {number} lat  — latitude in decimal degrees
 * @param {number} lon  — longitude in decimal degrees
 * @returns {{ E: number, N: number }}  — ITM coordinates in metres
 */
export function wgs84ToItm(lat, lon) {
    const phi = lat * Math.PI / 180;
    const lam = lon * Math.PI / 180;
    const dLam = lam - LON0;

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const tanPhi = Math.tan(phi);

    const nu = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
    const rho = A * (1 - E2) / Math.pow(1 - E2 * sinPhi * sinPhi, 1.5);
    const eta2 = nu / rho - 1;

    const M  = meridianArc(phi);
    const M0 = meridianArc(LAT0);

    const I    = M - M0;
    const II   = nu / 2 * sinPhi * cosPhi;
    const III  = nu / 24 * sinPhi * cosPhi ** 3 * (5 - tanPhi ** 2 + 9 * eta2);
    const IIIA = nu / 720 * sinPhi * cosPhi ** 5 * (61 - 58 * tanPhi ** 2 + tanPhi ** 4);
    const IV   = nu * cosPhi;
    const V    = nu / 6 * cosPhi ** 3 * (nu / rho - tanPhi ** 2);
    const VI   = nu / 120 * cosPhi ** 5 * (5 - 18 * tanPhi ** 2 + tanPhi ** 4 + 14 * eta2 - 58 * tanPhi ** 2 * eta2);

    const N = K0 * (I + II * dLam ** 2 + III * dLam ** 4 + IIIA * dLam ** 6) + FN;
    const Ev = K0 * (IV * dLam + V * dLam ** 3 + VI * dLam ** 5) + FE;

    return { E: Math.round(Ev), N: Math.round(N) };
}
