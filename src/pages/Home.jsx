import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CITIES, MIN_RENTAL_DAYS, addDays } from '../data.js';
import { useCars } from '../cars.js';
import { listCars } from '../api.js';
import { CarCard, CarCardSkeleton, EmptyState } from '../components.jsx';
import { DateRangeCalendar, fmtShort } from '../Calendar.jsx';
import { CheckIcon, MapPinIcon, XIcon, UsersIcon, SteeringIcon, ChevronRightIcon } from '../icons.jsx';
import { useScrollLock } from '../useScrollLock.js';

/** Mirrors the GET /cars filter surface (min_price/max_price, body_type,
 * min_seats, transmission, fuel_type, driver_option). Applied client-side
 * against the already-loaded catalogue, except "Delivered to me" in a chosen
 * city, which asks the API (GET /cars?delivers_to=City). */
const EMPTY_FILTERS = {
  minPrice: 0,
  maxPrice: 0,
  types: [],
  minSeats: 0,
  transmission: '',
  fuels: [],
  drive: '',
  delivery: false,
};

const PRICE_BANDS = [
  { label: 'Any price', min: 0, max: 0 },
  { label: 'Under 4,000', min: 0, max: 4000 },
  { label: '4,000 – 7,000', min: 4000, max: 7000 },
  { label: '7,000 – 10,000', min: 7000, max: 10000 },
  { label: '10,000+', min: 10000, max: 0 },
];

const SEAT_BANDS = [
  { label: 'Any', min: 0 },
  { label: '4+', min: 4 },
  { label: '5+', min: 5 },
  { label: '7+', min: 7 },
];

const DRIVE_OPTIONS = [
  { label: 'Any', value: '' },
  { label: 'Self drive', value: 'self' },
  { label: 'With chauffeur', value: 'chauffeur' },
];

function matchesFilters(c, f, deliversHere) {
  if (f.delivery && !c.deliveryAvailable) return false;
  if (f.delivery && deliversHere && !deliversHere.has(c.id)) return false;
  if (f.minPrice && c.pricePerDay < f.minPrice) return false;
  if (f.maxPrice && c.pricePerDay > f.maxPrice) return false;
  if (f.types.length && !f.types.includes(c.type)) return false;
  if (f.minSeats && c.seats < f.minSeats) return false;
  if (f.transmission && c.transmission !== f.transmission) return false;
  if (f.fuels.length && !f.fuels.includes(c.fuel)) return false;
  if (f.drive === 'self' && !c.driveTypes.includes('self')) return false;
  if (f.drive === 'chauffeur' && !c.driveTypes.includes('withDriver')) return false;
  return true;
}

function countActiveFilters(f) {
  return (
    (f.minPrice || f.maxPrice ? 1 : 0) +
    (f.types.length ? 1 : 0) +
    (f.minSeats ? 1 : 0) +
    (f.transmission ? 1 : 0) +
    (f.fuels.length ? 1 : 0) +
    (f.drive ? 1 : 0) +
    (f.delivery ? 1 : 0)
  );
}

/** Flatten the active filters into individually-removable chips shown under the
 * search bar. Each `clear` returns the filters with just that facet removed. */
function activeFilterChips(f, city) {
  const chips = [];
  if (f.delivery) {
    chips.push({
      key: 'delivery',
      label: city && city !== 'All cities' ? `Delivered in ${city}` : 'Delivery',
      clear: (d) => ({ ...d, delivery: false }),
    });
  }
  if (f.minPrice || f.maxPrice) {
    const band = PRICE_BANDS.find((b) => b.min === f.minPrice && b.max === f.maxPrice);
    const label = band
      ? band.label
      : f.maxPrice
      ? `${f.minPrice.toLocaleString()} – ${f.maxPrice.toLocaleString()}`
      : `${f.minPrice.toLocaleString()}+`;
    chips.push({ key: 'price', label, clear: (d) => ({ ...d, minPrice: 0, maxPrice: 0 }) });
  }
  f.types.forEach((t) =>
    chips.push({ key: `type-${t}`, label: t, clear: (d) => ({ ...d, types: d.types.filter((x) => x !== t) }) })
  );
  if (f.minSeats)
    chips.push({ key: 'seats', label: `${f.minSeats}+ seats`, clear: (d) => ({ ...d, minSeats: 0 }) });
  if (f.transmission)
    chips.push({ key: 'transmission', label: f.transmission, clear: (d) => ({ ...d, transmission: '' }) });
  f.fuels.forEach((fl) =>
    chips.push({ key: `fuel-${fl}`, label: fl, clear: (d) => ({ ...d, fuels: d.fuels.filter((x) => x !== fl) }) })
  );
  if (f.drive) {
    const label = DRIVE_OPTIONS.find((o) => o.value === f.drive)?.label || f.drive;
    chips.push({ key: 'drive', label, clear: (d) => ({ ...d, drive: '' }) });
  }
  return chips;
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" className={`filter-chip${on ? ' on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** Near-fullscreen filter sheet. Keeps a local draft so nothing changes on the
 * page until "Show cars" is pressed; the button shows the live match count. */
function FilterModal({ open, onClose, baseCars, options, applied, onApply, city, deliversHere }) {
  const [draft, setDraft] = useState(applied);
  useScrollLock(open);

  useEffect(() => {
    if (open) setDraft(applied);
  }, [open, applied]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleArr = (key, val) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(val) ? d[key].filter((x) => x !== val) : [...d[key], val],
    }));
  const setOne = (key, val) => setDraft((d) => ({ ...d, [key]: d[key] === val ? '' : val }));
  const setPrice = (min, max) => setDraft((d) => ({ ...d, minPrice: min, maxPrice: max }));

  const count = baseCars.filter((c) => matchesFilters(c, draft, deliversHere)).length;

  return (
    <div className="filter-overlay" onClick={onClose}>
      <div
        className="filter-modal"
        role="dialog"
        aria-label="Filter cars"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="filter-head">
          <h2>Filters</h2>
          <button className="filter-close" aria-label="Close filters" onClick={onClose}>
            <XIcon size={18} />
          </button>
        </div>

        <div className="filter-body">
          <div className="filter-section">
            <h3>Price per day</h3>
            <div className="chip-row">
              {PRICE_BANDS.map((band) => (
                <Chip
                  key={band.label}
                  on={draft.minPrice === band.min && draft.maxPrice === band.max}
                  onClick={() => setPrice(band.min, band.max)}
                >
                  {band.label}
                </Chip>
              ))}
            </div>
          </div>

          {options.types.length > 0 && (
            <div className="filter-section">
              <h3>Car type</h3>
              <div className="chip-row">
                {options.types.map((t) => (
                  <Chip key={t} on={draft.types.includes(t)} onClick={() => toggleArr('types', t)}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="filter-section">
            <h3>Seats</h3>
            <div className="chip-row">
              {SEAT_BANDS.map((s) => (
                <Chip
                  key={s.label}
                  on={draft.minSeats === s.min}
                  onClick={() => setDraft((d) => ({ ...d, minSeats: s.min }))}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>

          {options.transmissions.length > 0 && (
            <div className="filter-section">
              <h3>Transmission</h3>
              <div className="chip-row">
                {options.transmissions.map((t) => (
                  <Chip
                    key={t}
                    on={draft.transmission === t}
                    onClick={() => setOne('transmission', t)}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {options.fuels.length > 0 && (
            <div className="filter-section">
              <h3>Fuel</h3>
              <div className="chip-row">
                {options.fuels.map((f) => (
                  <Chip key={f} on={draft.fuels.includes(f)} onClick={() => toggleArr('fuels', f)}>
                    {f}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="filter-section">
            <h3>Delivery</h3>
            <div className="chip-row">
              <Chip
                on={draft.delivery}
                onClick={() => setDraft((d) => ({ ...d, delivery: !d.delivery }))}
              >
                {city && city !== 'All cities' ? `Delivered to me in ${city}` : 'Delivered to me'}
              </Chip>
            </div>
          </div>

          <div className="filter-section">
            <h3>Drive option</h3>
            <div className="chip-row">
              {DRIVE_OPTIONS.map((o) => (
                <Chip
                  key={o.label}
                  on={draft.drive === o.value}
                  onClick={() => setDraft((d) => ({ ...d, drive: o.value }))}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="filter-foot">
          <button type="button" className="filter-reset" onClick={() => setDraft(EMPTY_FILTERS)}>
            Reset
          </button>
          <button className="btn-primary" onClick={() => onApply(draft)}>
            {count === 0 ? 'No matches' : `Show ${count} car${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const SHELF_SIZE = 6;

/** Partition the catalogue into clean rows of six, each with a psychology-led
 * title. Cars are pulled from a shrinking pool by each shelf's theme, so every
 * car appears in exactly one section (no repeats) and the last shelf simply
 * keeps whatever's left. Built on fields that actually vary (year, seats,
 * price) — ratings/favourites are still empty upstream. */
function buildShelves(cars) {
  const pool = [...cars];
  const take = (sorter) => {
    pool.sort(sorter);
    return pool.splice(0, Math.min(SHELF_SIZE, pool.length));
  };

  const shelves = [];
  const add = (key, title, sub, list) => {
    if (list.length) shelves.push({ key, title, sub, cars: list });
  };

  add('fresh', 'Just landed', 'The newest cars on Ardena, fresh this week',
    take((a, b) => b.year - a.year));
  add('crew', 'Room for the whole crew', 'Seven seats and up for the whole group',
    take((a, b) => b.seats - a.seats || a.pricePerDay - b.pricePerDay));
  add('premium', 'Make an entrance', 'Premium picks for the days that matter',
    take((a, b) => b.pricePerDay - a.pricePerDay));
  add('budget', 'More car, less cash', 'Easy on the wallet, big on value',
    take((a, b) => a.pricePerDay - b.pricePerDay));
  add('trusted', 'Everyday favourites', 'Dependable rides drivers come back to', pool.splice(0));

  return shelves;
}

function CarShelf({ title, sub, cars }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2 className="shelf-title">{title}</h2>
        {sub && <p className="shelf-sub">{sub}</p>}
      </div>
      <div className="grid shelf-cards">
        {cars.map((car) => (
          <CarCard key={car.id} car={car} />
        ))}
      </div>
    </section>
  );
}

function ShelfSkeleton() {
  return (
    <section className="shelf" aria-hidden="true">
      <div className="shelf-head">
        <div className="skel-line" style={{ width: 200, height: 20, marginTop: 0 }} />
        <div className="skel-line" style={{ width: 260, height: 12 }} />
      </div>
      <div className="grid shelf-cards">
        {Array.from({ length: SHELF_SIZE }, (_, i) => (
          <CarCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { cars: allCars, loading, error } = useCars();
  const [city, setCity] = useState('All cities');
  const [pickup, setPickup] = useState(addDays(new Date(), 1));
  const [dropoff, setDropoff] = useState(addDays(new Date(), 1 + MIN_RENTAL_DAYS));
  const [calOpen, setCalOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setCalOpen(false);
        setCityOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const cityCars = useMemo(
    () => allCars.filter((car) => city === 'All cities' || car.city === city),
    [allCars, city]
  );

  // "Delivered to me": in a chosen city, the API says which cars deliver there.
  const [deliversHere, setDeliversHere] = useState(null);
  const wantsDelivery = filters.delivery || filterOpen;
  useEffect(() => {
    if (!wantsDelivery || city === 'All cities') {
      setDeliversHere(null);
      return undefined;
    }
    let on = true;
    listCars({ delivers_to: city, limit: 100 })
      .then((data) => {
        if (on) setDeliversHere(new Set((data.cars || []).map((c) => String(c.id))));
      })
      .catch(() => {
        if (on) setDeliversHere(null);
      });
    return () => {
      on = false;
    };
  }, [wantsDelivery, city]);

  // Delivery widens "where": a car based elsewhere that delivers here still counts.
  const placeCars = useMemo(
    () =>
      filters.delivery && deliversHere
        ? allCars.filter((car) => deliversHere.has(car.id))
        : cityCars,
    [allCars, cityCars, filters.delivery, deliversHere]
  );

  const cars = useMemo(
    () => placeCars.filter((c) => matchesFilters(c, filters, deliversHere)),
    [placeCars, filters, deliversHere]
  );

  const shelves = useMemo(() => buildShelves(cars), [cars]);

  const filterOptions = useMemo(
    () => ({
      types: [...new Set(allCars.map((c) => c.type).filter(Boolean))].sort(),
      transmissions: [...new Set(allCars.map((c) => c.transmission).filter(Boolean))].sort(),
      fuels: [...new Set(allCars.map((c) => c.fuel).filter(Boolean))].sort(),
    }),
    [allCars]
  );

  const activeFilters = countActiveFilters(filters);
  const activeChips = activeFilterChips(filters, city);

  const whenLabel =
    pickup && dropoff ? `${fmtShort(pickup)} – ${fmtShort(dropoff)}` : pickup ? `${fmtShort(pickup)} – ?` : 'Add dates';

  return (
    <div className="page">
      <div className="container wide">
        <div className="hero">
          <div className="searchbar-wrap" ref={wrapRef}>
            <div className="searchbar">
              <button
                type="button"
                className="search-field"
                onClick={() => {
                  setCityOpen((v) => !v);
                  setCalOpen(false);
                }}
              >
                <label style={{ cursor: 'pointer' }}>Where</label>
                <div className="value">{city}</div>
              </button>
              <button
                type="button"
                className="search-field"
                onClick={() => {
                  setCalOpen((v) => !v);
                  setCityOpen(false);
                }}
              >
                <label style={{ cursor: 'pointer' }}>When</label>
                <div className={`value${pickup ? '' : ' placeholder'}`}>{whenLabel}</div>
              </button>
              <button
                className="search-icon-btn"
                aria-label="Search and filter cars"
                onClick={() => {
                  setCalOpen(false);
                  setCityOpen(false);
                  setFilterOpen(true);
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <line x1="15.5" y1="15.5" x2="21" y2="21" />
                </svg>
                <span className="search-btn-label">Search cars</span>
                {activeFilters > 0 && <span className="filter-badge">{activeFilters}</span>}
              </button>
            </div>

            {cityOpen && (
              <div className="dd-pop">
                {CITIES.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`dd-item${c === city ? ' selected' : ''}`}
                    onClick={() => {
                      setCity(c);
                      setCityOpen(false);
                    }}
                  >
                    <span className="dd-label">
                      <MapPinIcon size={16} />
                      {c}
                    </span>
                    {c === city && <CheckIcon size={16} />}
                  </button>
                ))}
              </div>
            )}

            {calOpen && (
              <div className="cal-pop center">
                <DateRangeCalendar
                  start={pickup}
                  end={dropoff}
                  minDate={addDays(new Date(), 1)}
                  onChange={(s, e) => {
                    setPickup(s);
                    setDropoff(e);
                    if (s && e) setCalOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          {activeChips.length > 0 && (
            <div className="active-filters">
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="active-filter"
                  onClick={() => setFilters((d) => c.clear(d))}
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label}
                  <XIcon size={13} />
                </button>
              ))}
              <button
                type="button"
                className="active-filter-clear"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <>
            <ShelfSkeleton />
            <ShelfSkeleton />
          </>
        ) : error ? (
          <div className="empty">Couldn&apos;t load cars — {error}</div>
        ) : cityCars.length === 0 ? (
          <EmptyState
            title={`No cars in ${city} just yet`}
            message="We're signing up verified hosts across Kenya all the time. Try another city or take a look at the whole fleet."
            action={
              city !== 'All cities' && (
                <button className="btn-primary" onClick={() => setCity('All cities')}>
                  Show cars in all cities
                </button>
              )
            }
          />
        ) : cars.length === 0 ? (
          <EmptyState
            title="No cars match your filters"
            message="Try loosening a filter or two to see more of the fleet."
            action={
              <button className="btn-primary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            }
          />
        ) : (
          <>
            {shelves.map((s) => (
              <CarShelf key={s.key} title={s.title} sub={s.sub} cars={s.cars} />
            ))}
          </>
        )}

        <section className="promo-duo" aria-label="Ardena Chauffeurs">
          <Link to="/chauffeurs" className="promo-card">
            <span className="promo-icon">
              <UsersIcon size={20} />
            </span>
            <span className="promo-text">
              <b>Hire a driver</b>
              <span>Verified Ardena chauffeurs for your car or ours, by the hour or the day.</span>
            </span>
            <ChevronRightIcon size={18} />
          </Link>
          <Link to="/drive" className="promo-card">
            <span className="promo-icon">
              <SteeringIcon size={20} />
            </span>
            <span className="promo-text">
              <b>Drive with Ardena</b>
              <span>Earn as a chauffeur. Apply in a few minutes, no account needed to start.</span>
            </span>
            <ChevronRightIcon size={18} />
          </Link>
        </section>
      </div>

      <FilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        baseCars={deliversHere ? allCars : cityCars}
        city={city}
        deliversHere={deliversHere}
        options={filterOptions}
        applied={filters}
        onApply={(f) => {
          setFilters(f);
          setFilterOpen(false);
        }}
      />
    </div>
  );
}
