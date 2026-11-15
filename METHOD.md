# METHOD — Rolling Stock Gauge Simulator

This file is **the specification**. Every equation, symbol, unit and assumption used by the simulator is
written here first and then coded in `js/engine.js`. If the code and this file disagree, this file is right
and the code is a bug.

The method is the one of the owner's gauging workbook *Vehicle Gauging Calculation Tool* (sheets Method &
Formulas, Static Calc, Dynamic Calc, Dynamic Gauge Output). The engine reproduces that workbook to within 10⁻⁹ mm
for the same inputs and options; `tests/workbook.test.js` (static) and `tests/workbook-dynamic.test.js`
(dynamic) check it on fictional inputs recalculated by the workbook.

> **Status:** sections 1–8 are implemented (static: Phase 2, dynamic: Phase 3); section 10 (EN 15273-2:2009
> kinematic method, static option) in Phase 4.

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
(floor / platform) and `h2` (cantrail). SOD profiles and point items are used by the dynamic outline check (§8.7).

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

## 8. Dynamic calculation (chainage sweep)

### 8.1 Track model and sweep

* Elements sorted by start chainage; signed curvature at start and end `k = ±1/R` (+ left, − right, 0 for R = 0).
* Sweep chainages: `ch0, ch0 + Δx, …` while ≤ the end of the track data (`Δx` = sweep step on the Track Data
  tab; start / end chainage options, blank = whole line). The end chainage itself is also evaluated and
  flagged *not valid*: it enters the maxima and minima but not the point counts (the workbook's repeated end rows).
* At chainage `x`: the element is the last one whose start is ≤ x; position `t = (x − s0)/(s1 − s0)` clamped to
  0…1; `k = ks + (ke − ks)·t`, cant `E = Es + (Ee − Es)·t` (linear in transitions); speed limit, Rv, KE,
  location, wind, structure and platform data of the element (blank KE = the KE of the static check).

### 8.2 Constants per car type

* Load case for the dynamic calculation (option, tare default): `s`, `hc`, `Cw` of that load (§5.4 rules for the
  suspension state).
* `dT_in = (l−d)/2 + q + w* + fw`, `dT_out = A_end·dT_in`.
* Random terms at height h: interior `Δl + al* + θr·(h − hc) + θt·h` (or K·√Σ²), exterior with `Δl·A_end`
  only if gauge tolerance in the exterior is selected; `θr = s·CL/G`, `θt = CL/G` if selected.
* Profile for the dynamic gauge: the option, blank = car-end section profile of the car type; its half-widths
  `x_prof(h1)`, `x_prof(h2)` (all segments, §3).
* Window for the governing curvature: `ROUNDUP((a/2 + nE + p/2)/Δx)` sweep points each side.
* SOD design vehicle: `C`, `L`, `b` from the customer limits, blank = this car type's `a`, `Lb`, `p`.

### 8.3 At each sweep point

| Quantity | Formula |
|---|---|
| Governing curvature | local `|k|`, or (conservative, default) the largest `|k|` within ± window points |
| Governing radius | `Rg = 1/|k_gov|` (0 = straight) |
| Equilibrium cant | `Eeq = G·(V/3.6)²·|k|/g` (local curvature, speed limit of the element) |
| Cant deficiency / excess | `I = max(Eeq − E, 0)` at line speed; excess = E (train stopped) |
| Wind speed | 0 if wind N; platform → `Vwp`; else `Vw` |
| Wind equivalent cant | `D = Cw·Vwind²` (if wind selected) |
| Gauge widening | `wd` if 0 < Rg < Rw |
| Overthrow | `dgi = (a² + p²)/8·|k_gov|`, `dga = (a·nE + nE² − p²/4)/2·|k_gov|` |
| Required half-width OUTSIDE at h | `x_prof(h) + dga + dT_out + A_end·wd/2 + s·(I + D)/G·(h − hc) + random_out(h)` |
| Required half-width INSIDE at h | `x_prof(h) + dgi + dT_in + wd/2 + s·(E + D)/G·(h − hc) + random_in(h)` |
| KE half-width | `W_KE(h1)`, `W_KE(h2)` of the element's KE (upper envelope) |
| Excess over the tangent KE | OUT `max(OUT(h1) − W_KE(h1), OUT(h2) − W_KE(h2))`, IN likewise |
| SOD extra allowance | `T_out = max((L² − C²)/8·|k_gov| − nosing, 0) + wd/2`; `T_in = max((C² + b²)/8·|k_gov| − nosing, 0) + wd/2` |
| SOD check | OK if excess OUT ≤ T_out + 0.05 and excess IN ≤ T_in + 0.05 |
| Lean due to cant | `h2·E/G` |
| Structure clearance at h2 | `S − max(OUT(h2) − lean, IN(h2) + lean)` (S = structure distance; none if 0) |
| Vertical-curve effect | crest `a²/(8Rv)`, sag `(a·nE + nE²)/(2|Rv|)` |
| Underframe height | `zu − Σd − vc − s_crush·(max(I, E) + Cw_crush·Vwind² + CL)/G·yu` ≥ cb |
| Platform position | at a platform: tangent if k = 0; inside if (side L and k > 0) or (side R and k < 0); else outside |
| Platform gap nominal | `PE − bs − (dgi inside, dga outside, 0 tangent)` |
| Platform gap minimum | `nominal − (dT_in + wd/2 + s·((E if inside) + D)/G·(hf − hc) + random_in(hf))`; < 0 → CONTACT; nominal > PRM → information |
| Overall | CHECK if SOD check, structure, underframe or platform fails |

### 8.4 Summaries

* Line summary: length, points, maximum deficiency (vs the limit), maximum excess OUT / IN, points above the SOD
  allowance, minimum structure clearance, minimum underframe height, minimum and maximum nominal platform gap,
  points with any CHECK; each with its chainage (first occurrence).
* Per element: maximum deficiency, OUT(h2), IN(h2), excess OUT / IN; minimum structure clearance and underframe
  height; status (not evaluated if no sweep point falls in the element).
* All car types: each car type is swept; the line summary takes the worst car type at each chainage (largest
  excesses and nominal gap, smallest clearances; CHECK if any car type checks), and names the governing car.

### 8.5 Speed-step study

Radius `R` (0 = tangent), cant `E`, wind speed and KE set in the options; speeds `0, ΔV, …` (13 steps by default):
`Eeq = G·(V/3.6)²/(g·R)`, `I = Eeq − E` (deficiency = max(I, 0), excess = max(−I, 0)), overthrow at R, the OUT / IN
half-widths of §8.3 at h1, h2, the KE half-widths and the maximum excess; remarks above the cant-deficiency limit
or above the design speed.

### 8.6 Cross-section at a chainage

Sweep point at or before the chainage (blank = largest outside excess). For each profile point: right side
(OUTSIDE) lateral `dga + dT_out + A_end·wd/2 + s·(I + D)/G·(h − hc) + random_out(h)` and roll
`θo = s·(I + D)/G + θr + θt`; left side (INSIDE) with dgi, dT_in, wd/2, E and `θi`. Track-plane point
`(±(x + E_lat), h − θ·x)`, rotated by `φ = asin(E/G)` into the vertical frame:
`X = x·cos φ − z·sin φ`, `Z = x·sin φ + z·cos φ`. The static profile, the KE and the KE + SOD allowance (x + T_out on
the right, x + T_in on the left) are rotated the same way; rails at ±750 mm.

### 8.7 SOD outline and point items

At every sweep point and for every car type, the whole dynamic-gauge profile (§8.2) is displaced as in §8.6:
OUTSIDE points (right in the curve frame) `(x + E_out(h), h − θo·x)`, INSIDE points (left) `(−(x + E_in(h)), h − θi·x)`;
the vehicle envelope is the closed polygon of these points. Frame (Customer KE & SOD tab): *track plane* — compared as
they are; *vertical* — envelope rotated by `φ = asin(E/G)` (§8.6).

**SOD outline.** The SOD profile named on the track element (blank = no outline check) is a half outline (Y ≥ 0),
mirrored. It is the tangent SOD: on curves it is widened laterally by the SOD allowance of §8.3, `y + T_out` on the
outside and `y + T_in` on the inside. Clearance of each envelope point = signed shortest distance to the widened outline,
positive inside the free space. Required: clearance ≥ the minimum clearance KE to SOD (Customer KE & SOD tab). The
smallest clearance and its point are kept per sweep point.

**Point items.** Each item has Y, Z, a side (left, right, both; left / right in the direction of increasing chainage) and
an optional chainage range (blank = whole line); it is checked where the sweep chainage is within its range. Real side to
curve frame: left-hand curve (k > 0) → right is the outside; right-hand curve → left is the outside; tangent (k = 0) → both
hands are checked. Clearance = signed shortest distance from the item to the vehicle envelope, positive outside it;
margin = clearance − the item's required clearance ≥ 0. The smallest margin and its item are kept per sweep point.

Both checks enter the overall CHECK of the sweep point (§8.3), the line and element summaries (§8.4, smallest outline
clearance and item margin, points failing) and the worst-car envelope. Distances are true Euclidean distances to the
polygon edges (not the horizontal / vertical split of §6.4).

## 9. Verification

1. **Workbook reproduction** (`tests/workbook.test.js`): fictional inputs were entered in the reference workbook
   and recalculated (LibreOffice); for several option sets (linear / RSS, deflated, theoretical s and hc, gauge
   and alignment tolerance, rigid tilt, upward movement with roll, static curve with widening, shared bogies) the
   engine matches every case minimum, governing point, Method A row and vertical check.
2. **Dynamic reproduction** (`tests/workbook-dynamic.test.js`): a fictional 4.4 km line with transitions,
   vertical curves, platforms, tunnels and a depot curve, swept in the workbook for four option sets (conservative
   / local overthrow, tare / crush, RSS, deflated, tolerances and tilt, theoretical s and hc, no wind): every
   column of every sweep row, the line summary, the per-element table, the speed-step study and the cross-section
   outline match.
3. **SOD outline and items** (`tests/sod-outline.test.js`): closed-form cases (rectangular outline on tangent, curve
   widening, cant rotation in the vertical frame, item sides and ranges, curve hand).
4. Closed-form checks: tangent with no movement gives clearance = gap to the KE; yaw factor; wind constant;
   theoretical s from the closed form; axle load by statics.
5. **EN 15273-2** (`tests/en15273.test.js`): reductions and z_kin against the standard's formulae A.24, A.27–A.31
   and A.46–A.50 typed in literally, 40 000 random vehicles, both branches; a hand check. Heights of A.3.4
   (`tests/en15273-vertical.test.js`): Table A.1 zones and A.16–A.19 typed in literally, hand checks of the sample.
   Bogie parts (`tests/en15273-bogie.test.js`): A.56–A.59 typed in literally, hand check of the sample.
   Static gauge (`tests/en15273-static.test.js`): A.2–A.5 typed in literally, s limit, hand check of the sample.
6. Inputs are never mutated; results are deterministic.

## 10. EN 15273-2:2009 kinematic method (static option)

Optional check on the Static Simulation tab (*Also check EN 15273-2:2009 kinematic*). The **customer KE is the
reference profile**; its associated rules are the parameters on the Customer KE & SOD tab, with the values of gauge
G1 (EN 15273-2:2009 Annex A.3) as defaults. Implemented from the 2009 edition (superseded by EN 15273-2:2013; to be
updated when that edition is used). §5.1.1: the half-width of the vehicle shall not exceed the half-width of the
reference profile reduced by `Ei` (sections between the bogie centres) or `Ea` (sections beyond them).

### 10.1 Rules (Customer KE & SOD tab, G1 values)

| Symbol | Meaning | G1 |
|---|---|---|
| `l_max` | maximum track gauge of the rules | 1,465 m |
| `e0` | lateral allowance included in the reference profile | 0,015 m |
| `R1`, `R2` | reference radii | 250 m, 150 m |
| `Ck` | overthrow allowance `k = Ck/R` – lower parts / upper parts | 2,5 / 3,75 m² |
| `Xi`, `Xa` | x-term constants between / beyond the bogie centres | 100 / 120 m² |
| `h_low` | lower parts: up to this height above the rail | 0,400 m |
| `s0`, `hc0` | reference flexibility and roll-centre height | 0,4; 0,5 m |
| `I0`, `D0` | cant excess (inside) / deficiency (outside) in the reference profile | 0,05 m |
| `Dlim` | cant excess / deficiency limit | 0,2 m |
| `L` | distance between rail centres of the rules | 1,5 m |
| `η_lim` | dissymmetry included in the reference profile | 1° |

### 10.2 Vehicle data

* Formula set (Table A.4): no motor bogie → coach formulae A.3.9.3; two motor bogies (bogie input *Motor bogie*,
  adhesion μ ≥ 0,2) → traction-unit formulae A.3.9.1; one motor bogie → traction-unit formulae by default (note a of
  Table A.4) or the motor-coach formulae A.3.9.2 (Static Simulation option).
* `a` pivot distance; per bogie: wheelbase `p`, secondary lateral clearance `w∞` (straight track; deflated `w` when the
  lateral state is deflated), `w(250)` and `w(150)` (blank = constant), and, for variable stops, the radius `Rv` where
  they start with `w(Rv)`. `d` = BB + 2·ef worn (smaller of the two bogies: largest play), `q` larger of the two.
* Sections: interior at `n = ni` (between the bogie centres), exterior at `n = na` and car end at `n = n_end` (beyond),
  with the profiles of §6. `s`, `hc` of tare and crush (§5.4 source and suspension state); `E` is the larger of the two.
  For a section beyond a pivot the bogie at that end (`a`, weight `(n + a)/a`) and the far bogie (`i`, weight `n/a`) can
  be either bogie of the car: both orientations are evaluated and the larger `E` is used.
* `η0`: body dissymmetry (car body input, default 0).

### 10.3 Quasi-static term z_kin (A.3.8.1, A.24)

With `C0 = I0` for `Ei` and `C0 = D0` for `Ea`, `k2 = (Dlim − C0)/L`:

`z = s·C0/L·(h − hc)>0 + tan(η0 − η_lim)>0·|h − hc| + [ s·k2·(h − hc)>0 − s0·k2·(h − hc0)>0 ]>0`

Special cases (η0 ≤ η_lim): `z = 0` for `h < hc0`; `z = s·C0/L·(h − hc)>0` for `s ≤ s0`. With the G1 values this is
`s/30·(h − hc) + [s/10·(h − hc) − 0,04·(h − 0,5)]` of A.24. Unsprung parts (z = 0) are not distinguished: every
profile point is treated as part of the body.

### 10.4 Reductions – traction units and coaches (A.3.9.1.1, A.3.9.3.1)

`Δi = a·n − n² + p²/4`, `Δa = a·n + n² − p²/4` (p of the bogie at the section's end), `A = (2n + a)/a`, `P = (l_max − d)/2`,
`fa = (n + a)/a`, `fi = n/a`; `Ck` of the lower parts for `h ≤ h_low`, else of the upper parts; `k1 = 1/(2·R1)`,
`kx = 1/(2·R2) − 1/(2·R1)`. Between the pivots `w` is that of one bogie (both bogies are evaluated); beyond them
`w_i` (far bogie) and `w_a` (bogie at the end):

| | condition for the straight branch | straight branch | curve branch |
|---|---|---|---|
| Traction Ei (A.27–A.29) | `Δi − 2R1·(w∞ − w(250)) ≤ 2Ck` | `P + q + w∞ + z − e0` | `Δi·k1 + P + q + w(250) + z + [x]>0 − e0 − Ck/R1` |
| Traction Ea (A.30–A.32) | `Δa − 2R1·W ≤ 2Ck` | `(P + q)·A + w∞i·fi + w∞a·fa + z − e0` | `Δa·k1 + (P + q)·A + w_i(250)·fi + w_a(250)·fa + z + [x]>0 − e0 − Ck/R1` |
| Coach Ei (A.46–A.48) | `Δi − 2R1·(w∞ − w(250)) ≤ R1·(l_max − d) − 2·(Ck_up − Ck)` | `P + q + w∞ + z − e0` | `Δi·k1 + q + w(250) + z + [x]>0 − Ck/R1` |
| Coach Ea (A.49–A.51) | `Δa − 2R1·W ≤ R1·(l_max − d)·fi + 2Ck` | `(P + q)·A + w∞i·fi + w∞a·fa + z − e0` | `Δa·k1 + P·fa + q·A + w_i(250)·fi + w_a(250)·fa + z + [x]>0 − e0 − Ck/R1` |

with `W = (w∞i − w_i(250))·fi + (w∞a − w_a(250))·fa`; `x = (Δi − Xi)·kx + w(150) − w(250)` between the pivots and
`x = (Δa − Xa)·kx + (w_i(150) − w_i(250))·fi + (w_a(150) − w_a(250))·fa` beyond. With the G1 values (`2Ck` = 5 | 7,5,
`2R1` = 500, `kx` = 1/750, `e0 + Ck/R1` = 0,025 | 0,030, `Ck/R1` = 0,010 | 0,015, `Xi`, `Xa` = 100, 120) these are the
standard's formulae; the switching conditions are applied as written.

### 10.5 Motor coaches (A.3.9.2, A.37–A.45)

Unprimed: the motor bogie; primed: the carrying bogie. Each pair gives the larger of its two formulae (NOTE of A.3.9.2).

* Between the pivots, `n_μ` = distance from the motor bogie centre (both `n_μ = ni` and `a − ni` are evaluated),
  `fm = (a − n_μ)/a`, `fc = n_μ/a`, `Δ = a·n_μ − n_μ² + p²/4·fm + p'²/4·fc`:
  `Ei = max( P + q + w∞·fm + w'∞·fc + z − e0 ;  Δ·k1 + P·fm + q + w(250)·fm + w'(250)·fc + z + [x]>0 − Ck/R1 − e0·fm )`,
  `x = (Δ − Xi)·kx + (w(150) − w(250))·fm + (w'(150) − w'(250))·fc`.
* Beyond the pivots, motor bogie at the section's end (A.40–A.42): `Δ = a·n + n² − p²/4·fa + p'²/4·fi`,
  `Ea = max( (P + q)·A + w∞·fa + w'∞·fi + z − e0 ;  Δ·k1 + P·fa + q·A + w'(250)·fi + w(250)·fa + z + [x]>0 − e0 − Ck/R1 )`.
* Beyond the pivots, carrying bogie at the section's end (A.43–A.45): `Δ = a·n + n² + p²/4·fi − p'²/4·fa`,
  `Ea = max( (P + q)·A + w∞·fi + w'∞·fa + z − e0 ;  Δ·k1 + (P + q)·A + w(250)·fi + w'(250)·fa + z + [x]>0 − e0 − Ck/R1 )`.
* The section's `Ea` is the larger of the two ends. In A.41 the printed `w_i(250)` is read as `w'_i(250)` (the far,
  carrying bogie), as in A.40 and A.42.

### 10.6 Clearance w varying non-linearly – variable stops (A.3.9.1.2, A.3.9.3.2)

When a bogie has variable stops starting at radius `Rv` (with `w(Rv)`), the bracket formulae A.33 / A.35 (traction
units) and A.52 / A.54 (coaches) are also evaluated at `R = Rv`:
`Ei(Rv) = [(Δi − 2Ck)/(2Rv) + w(Rv)] + P + q + z − e0` (coach: `+ q + z`),
`Ea(Rv) = [(Δa − 2Ck)/(2Rv) + w_i(Rv)·fi + w_a(Rv)·fa] + (P + q)·A + z − e0` (coach: `+ P·fa + q·A + z − e0`),
and the reduction is the larger of these and §10.4. The 150 m variants (A.34, A.36, A.53, A.55) are not applied: by
footnotes 6 and 7 of the standard they do not apply in practice (variable stops act above 250 m); a warning is given
for `Rv` below 250 m. Not defined for motor coaches.

`tests/en15273.test.js` and `tests/en15273-mc.test.js` compare the engine with the standard's formulae typed in literally
(w constant and varying, motor coaches, variable stops).

### 10.7 Heights above the running surface (A.3.4)

Checked for every car type when the EN option is selected; part of the EN verdict.

**Lower parts (A.3.4.1).** One row per part on the Car body & Bogie tab (*Lower parts – EN 15273-2 A.3.4*): car type,
mounting (car body / bogie frame), position (between / beyond the pivots, or the axles for a bogie part), distance `n`
from the nearer pivot or axle (blank: between = mid, `a/2` or `p/2`; beyond = car-end overhang `n_end` for a body part,
0 for a bogie part), half-width `b`, height `h` above the rail with the car tare and new wheels, and the lower limit
`h_lim` at that position (blank = customer minimum clearance, body or bogie; the GIC1 / GIC2 heights of Figures A.5 /
A.6 at the part's half-width can be entered here). A car type without rows uses the two lower parts of the car body
inputs (§7.2: body part at `yu` between the pivots at `a/2`, bogie part between the axles).

* Body zones (Figure A.7): between the pivots A (`b ≤ b2`) or B (`b > b2`); beyond them D (`b ≤ b2`) or C (`b > b2`);
  `b2` = half spacing of the air springs, smaller of the two bogies.
* Table A.1, locomotives / coaches / motor coaches (no side-bearer clearance, body sag 0), `r = n/a`:

| Zone | Suspension | Wheel wear |
|---|---|---|
| A | `Aff` | `Usr` |
| B | `Aff + 0,1·s·(b − b2)` | `Usr` |
| C | `Aff + ΔAff·r + 0,1·s·(b − b2)` | `Usr + ΔUsr·r` |
| D | `Aff + ΔAff·r` | `Usr + ΔUsr·r` |

  `Aff` (car body input; blank = `dp + dsd`, primary + secondary downward travel with the air springs deflated, the
  total deflection of A.3.4.1.3), `ΔAff`, `s` (zone B / C term; 0 when `Aff` is a bottoming displacement, NOTE of Table
  A.1) and `ΔUsr` are car body inputs (default 0). `Usr` = wheel radial wear `Δw` of §5.3 (limited by the height
  correction step `Δr`, as the rest of the tool).
* Bogie-mounted parts: primary suspension `dp` + `Usr` (the zone terms apply to the body).
* Gradient transitions (A.3.4.1.6, all vehicles, `Rv ≥ 500 m`), normal values in m, the height required is increased by
  `[(a·n − n² + p²/4)/1000 − 0,08]>0` between the pivots (A.16) and `[(a·n + n² − p²/4)/1000 − 0,08]>0` beyond them
  (A.17); `p` = larger wheelbase between, smaller beyond (conservative). For a bogie part `a` is replaced by `p` and the
  `p²/4` term is 0 (A.3.4.1.5).
* Check: `h − suspension − wheel wear ≥ h_lim + gradient`; margin = left − right.

**Upper parts (A.3.4.2).** Per section (interior `n = ni` between, exterior `na` and car end `n_end` beyond): profile top
(empty, no wear: the RS profile as given) `+ 10 mm × suspension levels` (car body input, default 2) `+` A.18 / A.19 (same
expressions as A.16 / A.17) `≤` KE top. The vertical quasi-static component is not added (A.3.4.2.2). The standard
applies this to parts from 3,25 m; a lower profile top is flagged.

Not applied: the hump-shunting terms `dg` of A.3.4.1.5.1 (gravity-shunted vehicles), the wagon terms of Table A.1
(side-bearer clearance `J·b/bG`, body sag `Flc`), contact ramps (A.3.5), ferries (A.3.7). The GIC1 / GIC2 outlines are
not encoded: enter the limit at the part's position.

### 10.8 Bogie parts (A.3.11)

A.3.11: bogies and their parts use the reduction formulae of vehicles with independent axles (A.3.10.1, w = 0), the
bogie being the vehicle and its end axles the "pivots". One row per part on the Car body & Bogie tab (*Bogie parts –
EN 15273-2 A.3.11*): bogie type, mounting (bogie frame / axle or axlebox), position (between / beyond the end axles),
distance `n` from the nearer end axle (blank: between `p/2`, beyond 0), half-width `y` and height `h` (tare, new wheels).

With `a = p` (distance between the end axles), `P = (l_max − d)/2` (`d` = BB + 2·ef worn of that bogie type),
`q` primary lateral play, `k1 = 1/(2·R1)`, `Ck` of the lower parts for `h ≤ h_low`, else of the upper parts:

| | condition for the straight branch | straight branch | curve branch |
|---|---|---|---|
| Between, A.56 / A.57 | `Δi = a·n − n² ≤ 2Ck` | `P + q + z − e0` | `Δi·k1 + P + q + z − e0 − Ck/R1` |
| Beyond, A.58 / A.59 | `Δa = a·n + n² ≤ 2Ck` | `(P + q)·A + z − e0` | `Δa·k1 + (P + q)·A + z − e0 − Ck/R1` |

`A = (2n + a)/a`. In A.56 the printed condition `a·n_a + n_a²` is read as `a·n_i − n_i²` (as in A.57). With the G1
values (`2Ck` = 5 | 7,5, `e0` = 0,015, `e0 + Ck/R1` = 0,025 | 0,030) these are the standard's formulae; for bogies
`Δ` is small and the straight branches (= A.27 / A.30 with w = 0) apply, as the standard notes.

* `z` (A.24 with `C0 = I0` between, `D0` beyond): frame-mounted parts roll on the primary suspension with the bogie
  input `s` and `hc` of the frame (default 0 = no roll); axle-mounted parts are unsprung, `z = 0` (A.3.8.1.1). No
  dissymmetry term.
* Reference: the customer KE over its whole outline (lower notch included). The part moves vertically between
  `h − Δw − dp` and `h + up` (frame) or `h − Δw` and `h` (axle), `Δw` = wheel radial wear limited by `Δr`; the KE
  half-width used is the smallest over that range (at its ends and at every KE vertex inside).
* Margin = KE half-width − E − y; every bogie part must have margin ≥ 0 (in the EN verdict and the overall static
  verdict). The heights of bogie-mounted parts are checked in §10.7 (lower parts table, mounting *bogie frame*).
* Not applied: the 5 mm reduction of z for two-axle wagons (A.3.10.1, wagons only).

### 10.9 Static gauge method (A.2)

Optional (*Also check EN 15273-2:2009 static gauge method*, Static Simulation tab), independent of the kinematic check.
The reference profile is a profile on the Customer KE & SOD tab (option; blank = the KE of the static check), read like
a KE (upper envelope to `n_up`). Rules (Customer KE & SOD tab, G1 values): allowance `0,075 m`, minimum `Δ = 7,5 m²`,
`s_max = 0,2` (§5.1.3: 0,3 for GA, GB, GC), lower parts up to `0,43 m`; `l_max`, `R1`, `R2`, `Xi`, `Xa` as §10.1.

* A.2.3.1: the static gauge may be used only when the flexibility coefficient does not exceed `s_max`; `s` = larger of
  the tare and crush values used (§5.4 source and lateral state). Otherwise the car type fails the static-gauge check
  ("use the kinematic or dynamic method").
* Reductions, `P = (l_max − d)/2`, `w` = secondary lateral play used (§5.2), `q` primary, `k1 = 1/(2·R1)`,
  `kx = 1/(2·R2) − 1/(2·R1)`:
  * between the pivots (A.2, A.3): `Δi = max(a·n − n² + p²/4 ; Δmin)`, `x = (a·n − n² + p²/4 − Xi)·kx`,
    `Ei = [Δi·k1 + P + q + w + [x]>0 − allowance]>0`;
  * beyond them (A.4, A.5): `Δa = max(a·n + n² − p²/4 ; Δmin)`, `x = (a·n + n² − p²/4 − Xa)·kx`,
    `Ea = [Δa·k1 + (P + q + w)·(2n + a)/a + [x]>0 − allowance]>0`.
  With the G1 values (`2R1` = 500, `kx` = 1/750, 7,5, 100, 120, 0,075) these are A.2–A.5. `p` = larger wheelbase
  between the pivots, smaller beyond (conservative); `d` from the bogie with the larger play. No roll term: the static
  gauge contains no quasi-static allowance and is limited by `s_max` instead.
* Check of the RS profiles: at every profile vertex height and every reference vertex height within the profile,
  margin = `W_ref(h) − E − x_prof(h)` (reference half-width at `max(h, bottom of the upper envelope)`); the profile top
  shall not exceed the reference top.
* A.2.3.2 lower parts (rows of §10.7 with height ≤ 0,43 m): `h − Usr − (dp + dsd)` (bogie parts `h − Usr − dp`, total
  bottoming displacement) `≥` lower limit (entered, or the customer minimum). The GIS1 / GIS2 outlines are not encoded.
* The car type passes when s ≤ s_max, every margin ≥ 0, the tops fit and the lower parts are above their limits; the
  result is part of the verdict when the option is selected. Tests: `tests/en15273-static.test.js` (A.2–A.5 typed in).

### 10.10 Results

* Maximum construction gauge on the Method A heights (§7): `W_KE(h) − E(h)` per section, shown with the workbook
  Method A for comparison.
* Check of the RS profiles: at every profile vertex height and every KE vertex height within the profile height range,
  margin = `W_KE(h) − E(h) − x_prof(h)` (KE half-width at `max(h, bottom of the upper envelope)`, as §6). The car type
  passes when every margin ≥ 0; when the option is selected, the EN result is part of the car's verdict.
* Heights (§10.7): one row per lower part and per section, in the EN verdict.
* Bogie parts (§10.8): one row per part and bogie type.
* Static gauge (§10.9): per car type, when selected.
* Not covered yet: the GIC1/GIC2 and GIS1/GIS2 outlines as data (limits are entered), pantograph gauge (A.3.12), doors and steps open
  (A.3.14), other reference profiles (Annexes B–N) and the dynamic method (§5.2, Annex O); tilting vehicles (A.3.16)
  and wagons (A.3.10) are out of scope. Articulated units use the Figure 1
  equivalence; the formulae assume two-axle bogies (§5.1.2) – warnings are given otherwise.

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

Pantograph sway and catenary checks, multibody dynamic simulation, coupled-train (rescue) gauging, and curves below
150 m by the graphic method. (The sway-test evaluation and the kinematic gauge test plan are in §13.)

## 13. Test calculations (Tests tab)

### 13.1 Sway-test evaluation

The vehicle stands on straight, level track; shims of height `D` are put under the wheels of one side (cant `D` over
the rail-centre distance `L`). Each test row gives: car type, load state (tare, crush, deflated), `D`, the low side, and
the lateral displacement `y` of the body at two or three heights `h` above the rail — measured in the track plane
(perpendicular to the plane of the shimmed rails), relative to the reading at `D = 0` of the same load state, positive
towards the low rail.

Model (as §5): `y = s·(D/L)·(h − hc)`, i.e. `y = a·(D·h) + b·D` with `a = s/L`, `b = −s·hc/L`. For each car type and load
state, `a` and `b` are fitted by least squares over all readings (no intercept: the zero-cant reading is the reference):

`[Σu² Σuv; Σuv Σv²]·[a; b] = [Σu·y; Σv·y]`, `u = D·h`, `v = D`  →  `s = a·L`, `hc = −b/a`

with the RMS residual. At least two different heights are needed. When both sides were tested, `s` is also fitted per
side (the difference shows suspension asymmetry).

Acceptance (owner's choice: the roll displacement decides): the roll displacement per 100 mm of cant,
`m(h) = 100·s·(h − hc)/L`, measured ≤ the value used in gauging at `h1`, `h2` (Customer KE & SOD tab) and at the top of
the car type's RS profiles. Values used: `s`, `hc` of that load state from the source chosen for gauging (sway-test
inputs on the Car body tab or the theoretical values, §5.4).

### 13.2 Kinematic gauge test plan

For each car type and static case (§6, needs a static run), the case is reproduced on straight test track, and every
term of the static displacement is either **reproduced** on the test stand or **taken off the KE** to form the test
template (owner's choice: plays and shims are reproduced):

* Reproduced — shims: `D_test = cant + D_w` (cant excess for the interior, deficiency for the exterior and car end, plus
  the wind equivalent cant) under the low side, giving the roll `θq·(h − hc)` through the vehicle's own suspension.
* Reproduced — lateral, towards the low side: wheel–rail play, primary `q` and secondary `w`, each × `A` of the section
  (interior: both bogies pushed the same way; exterior / car end: bogies pushed in opposite directions to yaw the body),
  total `R_lat = (play + q + w)·A`.
* Taken off the KE: geometric overthrow at `Rs`, rail gauge-face wear, gauge widening, the random terms (gauge and
  alignment tolerance, cross-level roll and rigid tilt, linear or RSS as selected) and, vertically, the upward movement
  and the vertical shift of the random roll.

For each profile point with static `(x0, h0)` and the static run's displaced point `(x, h)`, KE width `W(h)` and KE height
`H(x)`:

| Quantity | Formula |
|---|---|
| Expected position on the test | `x_t = x0 + R_lat + θq·(h0 − hc)`, `h_t = h0 − θq·x0 − drop` |
| Lateral terms not reproduced | `N = E(h0) − R_lat − θq·(h0 − hc)` (E of §6.2) |
| Vertical terms not reproduced | `V = up − (θr + θt)·x0` |
| Test template | half-width `W_t = W(h) − N` at height `h_t`; height `H_t = H(x) − V` |
| Expected margins | `W_t − x_t = ΔX`, `H_t − h_t = ΔH`: equal to the static run (§6.4), so the plan is consistent with Method B |

Positions are measured perpendicular to the shimmed rail plane, as in the sway test. Crush cases need the crush load on
the vehicle (body lowering `drop`). When a sway test of the car type and load state is entered, the expected position
is also given with the measured `s`, `hc`: `x_m = x0 + R_lat + s_m·(D_test/L)·(h0 − hc_m)`, `h_m = h0 − s_m·(D_test/L)·x0 − drop`,
and its clearance to the template (§6.4); when `D_test` exceeds the largest shim of that sway test, the linear roll
model is used beyond the tested range and the plan says so. Note: a stiffer vehicle than assumed (smaller roll) moves less laterally but
its roof corners on the low side drop less (`h − θ·x`), so the clearance with the measured values can be smaller near the
KE top even when the sway-test acceptance of §13.1 is met; the plan shows both clearances.

