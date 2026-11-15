# METHOD — Rolling Stock Gauge Simulator

This file is **the specification**. Every equation, symbol, unit and assumption used by the simulator is
written here first and then coded in `js/engine.js`. If the code and this file disagree, this file is right
and the code is a bug.

The method is the one of the owner's gauging workbook *Vehicle Gauging Calculation Tool* (sheets Method &
Formulas, Static Calc, Dynamic Calc). The static engine reproduces that workbook to within 10⁻⁹ mm for the
same inputs and options; `tests/workbook.test.js` checks it on fictional inputs recalculated by the workbook.

> **Status:** sections 1–7 (inputs, derived values, static calculation) are implemented (Phase 2).
> Section 8 (dynamic, chainage sweep) is the specification for Phase 3. Section 10 (EN 15273-2 reference
> profile reductions) is kept for a later phase and is not used.

## 1. Purpose and approach

The tool calculates how much space a rail vehicle needs while it moves and compares it with the customer
kinematic envelope (KE) and with the structures along the line. The same list of movements is used in two
directions:

* **Method B – check:** added to the static car section, it gives the **generated KE**, which must lie inside
  the customer KE.
* **Method A – define:** subtracted from the customer KE, it gives the **maximum static half-width** the car
  section may have at each height.

**Static gauge** = car section on straight track (or a set static radius) with every movement at its limit.
**Dynamic gauge** = the same calculation evaluated at each chainage with the local curvature, cant, speed and
wind (Phase 3).

Calculation route: Train Configuration → Car body & Bogie → Customer KE & SOD → RS Profile → Track Data →
Static Simulation (options, Run) → Static Results → (Dynamic Simulation → Dynamic Results) → Overall Summary.

## 2. Standards and references

| # | Standard / document | Used for |
|---|---|---|
| 1 | EN 15273-1/-2/-3 (Gauges) | Structure of the lateral and vertical reductions, symbols (a, p, n, q, w, s, hc, A) |
| 2 | UIC 505-1 / 505-4 | Geometric overthrow formulas, yaw factor, flexibility coefficient definition |
| 3 | Customer Schedule of Dimensions (SOD) and Employer's Requirements | Customer KE, structure gauge, curve allowances, track tolerances, load and wind cases, clearances |
| 4 | EN 13803 | Limits of cant, cant deficiency and cant excess; equilibrium cant |
| 5 | EN 14363 | Validation of running dynamics / multibody models |
| 6 | EN 16586 / TSI PRM | Platform step and gap (75 mm) |
| 7 | BOStrab / tram rules | Below about 150 m radius use the graphic or swept-path method |

## 3. Conventions

* Profiles are **right half outlines**: x (shown as Y in the input tables) = distance from the track centre,
  h (Z) = height above the top of rail, entered in **mm** from the top centre clockwise down the side, as in the
  customer drawing. The engine works in m for coordinates and mm for movements.
* The car is checked leaning to the right (x ≥ 0); the left side is mirrored in the charts.
* Lengths of vehicle and radii in m; plays, travels, wear, tolerances, cant and clearances in mm; speeds in
  km/h; masses in t; stiffness in N/m and Nm/rad.
* **Upper envelope of the KE:** the first `n_up` points (down to the cut). The notch below it (solebar,
  collector shoe) is excluded from the car-body check. Blank `n_up` = all points.
* **KE half-width at a height,** `W_KE(h)`: the largest x of the upper-envelope segments that span h
  (piece-wise linear); 0 if none. In the point check h is first raised to the bottom of the upper envelope:
  `W_KE(max(h, h_nup))`.
* **KE top height at a half-width,** `H_KE(x)`: the largest h of the top-boundary segments (segments before the
  widest upper-envelope point whose x increases) that span x; 0 if none.
* **Profile half-width at a height,** `W_P(h)`: as `W_KE` over all segments of the profile.
* **Profile top** = h of its first point.

## 4. Inputs

### 4.1 Train configuration

Vehicle type (LRV / Metro / High-speed; *Apply typical values* loads `samples/vehicle-types.json`), design speed
`Vd`, nominal track gauge `l`, distance between rail centres `G` (cant base, 1500 mm for 1435 mm gauge), load
labels (tare AW0, crush AW4).

Per **car type**: body length `Lb`, overhang pivot → free end `n`, overhang at a shared end `nj`, end 1 / end 2
free or shared, interior section position `ni` (blank = a/2), exterior section position `na`, body width, floor
height `hf`, door-sill half-width `bs`, sprung body mass tare `m0` / crush `m4`, CG height tare `hG0` / crush
`hG4`, body lowering tare → crush `Δz`, bogie type at each end, RS profile of the interior, exterior and
car-end sections.

### 4.2 Car body

Per car type: wind-exposed length `Lw` (blank = Lb), top `zt` and bottom `zb` of the exposed side, force
coefficient `Cf`; lowest body-mounted equipment height `zu` (tare, new wheels) and its half-width `yu`; lowest
bogie-mounted equipment height `zbg`; **specified** flexibility coefficient `s` and roll-centre height `hc` for
tare, crush and deflated. Global: air density `ρ`, base for equivalent cant `Beq` (1510 mm).

### 4.3 Bogie

Per bogie type: wheelbase `p`; wheel–rail half play `(l − d)/2` (worn); primary lateral play `q`; secondary
lateral play to the bump stop `w` (inflated) and `wd` (deflated); wheel diameter new `Dn` / worn `Dw`; maximum
radial wear between height corrections `Δr`; vertical travels: primary downward `dp`, secondary downward
inflated `ds` / deflated `dsd`, primary rebound `up`, secondary rebound `us`, over-inflation `uo`; bogie mass `mb`,
axles per bogie; suspension stiffness for the theoretical s and hc (§5.4); play-calculator inputs (back-to-back
`BB`, flange thickness new `ef` / worn `efw`).

A car with two different bogie types uses the **larger** wheelbase, play and travel of the two (conservative);
with identical bogies this is the workbook calculation.

### 4.4 Customer KE, limits and SOD

KE profiles with `n_up`. Customer limits: minimum clearance of body-mounted `cb` and bogie-mounted `cbg`
equipment to the rail, axle-load limit `P`, PRM platform gap, nosing included in the tangent KE, SOD design
vehicle (bogie centres `C`, body length `L`, wheelbase `b`; blank = this vehicle), dynamic reference heights `h1`
(floor / platform) and `h2` (cantrail). SOD profiles and point items are kept for the dynamic phase.

### 4.5 Track data

Operating limits: maximum applied cant `E`, maximum cant deficiency `I`, maximum cant excess `Ie` (train stopped
on maximum cant), wind speed open line `Vw` and at platforms `Vwp`. Track tolerances: gauge tolerance `Δl`,
rail gauge-face wear `fw`, alignment tolerance `al`, cross-level error `CL`, gauge widening `wd` applying below
radius `Rw`. Static-check geometry: minimum radius `Rmin` (shared-bogie comparison), static radius `Rs`
(0 = tangent), crest radius `Rv` for the underframe check.

Track elements (dynamic phase): chainage start / end, Tangent / Transition / Circular, hand L/R, R start / end
(0 = ∞), cant start / end, speed limit, vertical curve Rv (+ crest, − sag), KE to use, location (Open / Tunnel /
Platform / Depot), wind Y/N, structure distance at h2, platform edge distance and side.

### 4.6 Options (Static Simulation tab)

| Option | Default | Effect |
|---|---|---|
| Customer KE | first KE | Envelope of the static check |
| s and hc source | Specified | Specified (§4.2) or theoretical (§5.4) |
| Theory: lateral elastic deflection in hc | Yes | Lateral term of §5.4 |
| Suspension state – lateral / roll | Inflated | Deflated uses deflated s, hc and w |
| Suspension state – vertical | Deflated | Secondary downward travel used in Σd |
| Combination of random terms | Linear | Linear, or K·√Σ(random²) |
| K (RSS) | 1 | Statistical factor |
| Gauge tolerance in exterior / car end | No | Reference method omits it |
| Alignment tolerance | No | Reference method lists but does not use it |
| Rigid tilt from cross-level error | No | Adds CL/G·h |
| Upward movement combined with roll | No | No = upward movement checked on the centre line only |
| Wind | Yes | Wind equivalent cant |
| Air-spring over-inflation | No | Adds `uo` to the upward movement |
| Method A heights | 900 mm to KE top, 100 mm | Table and chart of §7 |

## 5. Derived values per car type

### 5.1 Geometry

* End overhangs: `n1 = nj` if end 1 is shared, else `n`; `n2` likewise.
* Pivot distance: `a = Lb − n1 − n2`.
* Largest overhang (car-end section): `nE = max(n1, n2)`; check `na ≤ nE`.
* Yaw factor beyond the pivot: `A = (a + 2n)/a` → `A_ext` with n = na, `A_end` with n = nE; between pivots A = 1.

### 5.2 Wind as equivalent cant

* `Aw = Lw·(zt − zb)`, `F = ½·ρ·Cf·Aw·(V/3.6)²` [N].
* `Cw = ½·ρ·Cf·Aw·Beq / (m·g) / 3.6²` [mm/(km/h)²] for tare (m0) and crush (m4), so that `D = Cw·V²` [mm].
* `g = 9.81 m/s²`.

### 5.3 Vertical travels

* Radial wheel wear used: `Δw = min((Dn − Dw)/2, Δr)`.
* Total downward movement (lower parts): `Σd = Δw + dp + (dsd if vertical state deflated, else ds)`.
* Total upward movement (upper parts): `Σu = up + us + (uo if over-inflation selected)`.
* Secondary lateral play used: `w* = wd` if the lateral state is deflated, else `w`.

### 5.4 Theoretical flexibility coefficient and roll centre

Roll-stiffness share per body end: ψ = 1 for an own bogie, ½ for a shared bogie. With ψ1, ψ2 of the two ends:

* Primary roll stiffness: `Kφ1 = Σ ψ·np·kz1·b1²`
* Secondary roll stiffness: `Kφ2 = Σ ψ·(na·kz2·b2² + kφr)` with kz2 = tare / crush air-spring stiffness or the
  emergency-spring stiffness when deflated.
* In series: `Kφ = 1/(1/Kφ1 + 1/Kφ2)`; lateral: `Ky = 1/(1/Σψ·np·ky1 + 1/Σψ·na·ky2)` (ky2d when deflated;
  crush uses the tare lateral stiffness).
* Weights: `w1 = (hG − zp)/Kφ1`, `w2 = (hG − zs)/Kφ2` (zs deflated when deflated).
* Roll centre: `hc,0 = (w1·zp + w2·zs)/(w1 + w2)`; `hc = hc,0 − (1/Ky)/(w1 + w2)` if the lateral term is selected.
* Flexibility: `s = m·g·(hG − hc) / (Kφ − m·g·(hG − hc))` (from Kφ·η = m·g·h′·(δ + η), s = η/δ).
* Plausibility: s < 0 or s > 0.6 → "REVIEW – very soft in roll"; hc < 0.1 m → "REVIEW – low hc".
* States: tare (m0, hG0, kz2 tare), crush (m4, hG4, kz2 crush), deflated (m0, hG0, emergency spring).

Values used: lateral state deflated → the deflated s and hc for tare and crush; otherwise tare / crush of the
chosen source.

### 5.5 Shared-bogie comparison and axle load (crush)

* Pivot reactions: `R2 = m4·(Lb/2 − n1)/a`, `R1 = m4 − R2` (body CG at mid-length).
* Bogie loads: `Q1 = (2·R1 if end 1 shared, else R1) + mb1`, `Q2` likewise (identical neighbour assumed).
* Axle load: `P = max(Q1/axles1, Q2/axles2)`, checked against the limit.
* Throws at `Rmin`: mid `(a² + p²)/(8R)`, end `(a·nE + nE² − p²/4)/(2R)`; the same for the non-shared reference
  with `a_ref = Lb − 2n` and overhang n. Width lost (both sides) = `2·max(Δmid, Δend, 0)`.
* Largest pivot distance for the non-shared mid-throw: `a = √(8R·throw − p²)`.

### 5.6 Play calculator (information)

`l = nominal gauge + Δl`, `d = BB + 2·ef` (new), `BB + 2·efw` (worn); half play `(l − d)/2`.

## 6. Static calculation – Method B (check)

### 6.1 Cases

Six cases per car type: interior (between pivots, at `ni`), exterior (beyond the pivot, at `na`) and car end
(at `nE`), each tare and crush. Interior = **train stopped** on maximum cant (cant excess `Ie`); exterior and car
end = **train at speed** (cant deficiency `I`).

Case parameters:

| Quantity | Formula |
|---|---|
| Geometric overthrow at Rs | interior `dgi = (a·n − n² + p²/4)/(2Rs)`; exterior / end `dga = (a·n + n² − p²/4)/(2Rs)`; 0 on tangent |
| Yaw factor | 1 (interior), `A_ext`, `A_end` |
| Gauge widening | `wd/2` if 0 < Rs < Rw, else 0 |
| Quasi-static translation | `T = dg + A·[(l − d)/2 + q + w* + fw + wd/2]` |
| Random: gauge tolerance | interior `Δl`; exterior / end `Δl·A` only if selected |
| Random: alignment | `al` if selected |
| Cant | `Ie` (interior), `I` (exterior, end) |
| Wind equivalent cant | `Cw(load)·Vw²` if wind selected |
| Roll angle quasi-static | `θq = s·(cant + wind)/G` |
| Roll angle cross-level (random) | `θr = s·CL/G` |
| Rigid tilt (random) | `θt = CL/G` if selected |
| Total angle for vertical shift | `θ = θq + θr + θt` |
| Body lowering | `Δz` for crush, 0 for tare |
| Upward movement with roll | `Σu` if selected, else 0 |

### 6.2 Lateral movement at height h (mm)

* Linear: `E(h) = T + θq·(h − hc) + Δl* + al* + θr·(h − hc) + θt·h`
* Statistical: `E(h) = T + θq·(h − hc) + K·√(Δl*² + al*² + (θr·(h − hc))² + (θt·h)²)`

(h, hc in mm here; `Δl*`, `al*` are the random terms of §6.1.)

### 6.3 Displaced point

For each point (x, h) of the section profile:

`x′ = x + E(h)`, `h′ = h − θ·x − Δz + up`

### 6.4 Clearance of a point to the KE

* `ΔX = W_KE(max(h′, h_nup)) − x′`, `ΔH = H_KE(x′) − h′`
* Both ≥ 0: `c = ΔX·ΔH / √(ΔX² + ΔH²)` (0 if either is 0); both < 0: `c = −ΔX·ΔH / √(ΔX² + ΔH²)`;
  otherwise `c = min(ΔX, ΔH)`.
* `c ≥ 0` → OK (inside); `c < 0` → INFRINGES. Exact for a straight KE segment, conservative near corners.
* Case result: the minimum c over the points (first point if equal). Car result: the minimum over the six
  cases; run result: the minimum over the car types checked (governing car and case).

## 7. Method A (define) and vertical checks

### 7.1 Maximum static half-width

At each height h of the Method A grid (default 900 mm to the KE top in 100 mm steps, last height clipped to
the KE top):

* `x_max,int(h) = W_KE(h) − max(E_int,tare(h), E_int,crush(h))`, likewise exterior and car end.
* Margin to the section profile: `x_max − W_P(h)`; blank above the profile top (W_P = 0).
* Vertical shift is ignored (horizontal margins only); near the roof shoulder Method B governs.

### 7.2 Vertical checks

| Check | Value | Limit |
|---|---|---|
| Interior / exterior / car-end profile top + Σu (centre line) | `top + Σu` | KE top |
| Vertical-curve lowering at mid-car (crest Rv) | `a²/(8Rv)` | information |
| Roll lowering of the underframe edge | `max θ of the crush cases · yu` | information |
| Body-mounted equipment height, worst case | `zu − Σd − a²/(8Rv) − θ·yu` | ≥ cb |
| Bogie-mounted equipment height, worst case | `zbg − Δw − dp` | ≥ cbg |

## 8. Dynamic calculation (Phase 3 specification)

Chainage sweep at a fixed step from the start of the track data:

* Local curvature `k` (+ left) and cant interpolated linearly in the element (transitions); speed, Rv, KE,
  location, wind, structure and platform data of the element.
* Overthrow method: local radius, or (conservative, default) the largest |k| within ± (a/2 + nE + p/2) of the car
  centre (covers transitions and reverse curves).
* Equilibrium cant `Eeq = G·V²·|k|/g` (≈ 11.8·V²/R); deficiency `max(Eeq − E, 0)` at line speed; excess = E
  (train stopped).
* Wind speed by location (open / platform / none), wind equivalent cant `Cw·Vw²` (load case for the dynamic
  calculation, tare normally governs).
* Required half-width OUTSIDE (car end at speed) at h:
  `W_out(h) = x_prof(h) + dga + A_end·[(l−d)/2 + q + w* + fw] + A_end·wd/2 + s·(Idef + D)/G·(h − hc) + random`
* Required half-width INSIDE (mid-car, stopped):
  `W_in(h) = x_prof(h) + dgi + (l−d)/2 + q + w* + fw + wd/2 + s·(E + D)/G·(h − hc) + random`,
  with dgi = (a² + p²)/(8R), dga = (a·nE + nE² − p²/4)/(2R), evaluated at h1 and h2.
* Excess over the tangent KE half-width at h1 and h2, compared with the SOD extra horizontal allowance:
  `T_out = max((L² − C²)/(8R) − nosing, 0) + wd/2`, `T_in = max((C² + b²)/(8R) − nosing, 0) + wd/2`.
* Structure clearance at h2: `lean = h2·E/G`, `S − max(W_out − lean, W_in + lean)`.
* Underframe height: `zu − Σd − vertical-curve effect − s·(max(Idef, E) + Dcrush + CL)/G·yu` ≥ cb, where the
  vertical-curve effect is `a²/(8Rv)` (crest) or `(a·nE + nE²)/(2|Rv|)` (sag).
* Platform gap: nominal `PE − bs − throw towards the platform` (inside: dgi, outside: dga), minimum = nominal −
  movement at floor height; contact if negative; information if nominal > PRM value.
* Speed-step study: a set radius, cant and wind, speeds in steps from 0; maximum excess over the KE.
* Cross-section at a chosen chainage (outside = car end at line speed, inside = mid-car stopped), rotated by the
  cant angle `asin(E/G)` into the vertical frame.

## 9. Verification

1. **Workbook reproduction** (`tests/workbook.test.js`): fictional inputs were entered in the reference workbook
   and recalculated (LibreOffice); for several option sets (linear / RSS, deflated, theoretical s and hc, gauge
   and alignment tolerance, rigid tilt, upward movement with roll, static curve with widening, shared bogies) the
   engine matches every case minimum, governing point, Method A row and vertical check.
2. Closed-form checks: tangent with no movement gives clearance = gap to the KE; yaw factor; wind constant;
   theoretical s from the closed form; axle load by statics.
3. Inputs are never mutated; results are deterministic.

## 10. EN 15273-2 reference-profile reductions (later phase, not used)

Kept for a later phase: reductions `Ei` / `Ea` subtracted from a reference profile with its associated rules
(reference flexibility s0, roll-centre height hc0, cant allowances D0 / I0, overthrow allowance k = Ck/R). The
parameters are stored on the Customer KE & SOD tab but are not used by the current method. To be checked against
EN 15273-2 before implementation.

## 11. Assumptions and limitations

1. Quasi-static kinematic method: all terms added linearly unless the RSS option is selected. Dynamic
   movements beyond the bump-stop values (w) need multibody simulation and are not modelled.
2. The customer KE is a tangent-track, track-plane envelope; curve effects and lean due to cant belong to the
   structure gauge (SOD practice).
3. Only the lean side of each section is checked (x ≥ 0); the rising side moves inwards and is normally not
   governing — check tall, wide roof equipment separately.
4. Clearance from horizontal and vertical distances (§6.4): exact for a straight KE segment, conservative near
   corners.
5. Theoretical s and hc use a two-stage roll model; the sway test governs. Inter-car roll coupling of shared
   bogies is ignored; an identical neighbour body is assumed for shared-bogie loads.
6. The throw formulas are valid for two-bogie bodies and R ≥ about 150 m; below that use the graphic or
   swept-path method.
7. Default options reproduce the reference method choices: no gauge tolerance on exterior / car end, no
   alignment tolerance, upward movement on the centre line only.
8. A car with two different bogie types uses the larger play, travel and wheelbase of the two.

## 12. Out of scope

Pantograph sway and catenary checks, multibody dynamic simulation, coupled-train (rescue) gauging, the
validation and test calculations (sway-test evaluation, kinematic-test shims), and curves below 150 m by the
graphic method.
