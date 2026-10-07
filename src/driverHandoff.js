// "Driver plus an Ardena car, without a licence": the renter hires the driver
// first (car_source "ardena"), then books the car with chauffeur_booking_id.
// The hire waiting for its car is kept here between the two flows.

const KEY = 'ardena.web.driverForCar';

/** { id: "chb_…", name } | null */
export function getPendingDriverHire() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function setPendingDriverHire(hire) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(hire));
  } catch {
    /* storage unavailable: the renter can still pick a car, just without the link */
  }
}

export function clearPendingDriverHire() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
