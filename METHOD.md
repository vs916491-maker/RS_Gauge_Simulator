# METHOD — Rolling Stock Gauge Simulator

This file is **the specification**. Every equation, symbol, unit and assumption used by the
simulator is written here first and then coded in `js/engine.js` (Phase 2). If the code and this
file disagree, this file is right and the code is a bug.

> **Status (Phase 1):** the input model (sections 2–3) is implemented. The calculation sections
> (4–10) are the draft for review before the engine is written. Items marked **[verify]** are to be
> checked against the user's copy of EN 15273-2:2009 and against the customer's own gauging rules.

## 1. Purpose and scope

The tool does two jobs for one train:

1. **Static (profile) check** on a reference track condition:
   * **Forward / checking method** — take our rolling stock (RS) static profile, add every vehicle
     and track movement and obtain **our kinematic envelope (KE)**. If our KE is inside the
     **customer KE** at every point, the RS profile is acceptable.
   * **Backward / define method** — take the customer KE, subtract every movement and obtain the
     **maximum static profile** (maximum construction gauge) that the car body, bogie and
     underframe equipment must stay inside.
2. **Dynamic (route) check** — along the line, chainage by chainage (curve radius, cant, vertical
   curve, speed limit, section type), build our KE for that location and compare it with the
   **structure gauge / SOD** of that location, giving the clearance at every chainage.

Two calculation methods are offered and selected in the simulation tabs:

* **Metro SOD-style** (section 6): movement-by-movement build-up, deterministic terms added
  linearly, random terms combined by root-sum-square (RSS) or linearly.
* **EN 15273-2 kinematic method** (section 7): reductions `E_i` / `E_a` applied to a
  reference profile with its associated rules (reference flexibility `s_0`, cant allowances
  `D_0` / `I_0`, overthrow allowance *k*).

## 2. Coordinate system and conventions

* **y** — lateral distance from the track centre line, mm, positive outwards. Profiles are entered as
  the **right half** (y ≥ 0) and are **symmetric** about the centre line; the left half is the mirror
  image. Movements are applied to both sides and the envelope of both is taken.
* **z** — height above the top of rail (running plane), mm, measured perpendicular to the running
  plane. All KE and RS profiles are in the **track plane** unless stated otherwise.
* **x** — longitudinal position of a cross-section along the car body, m.
* A profile is an ordered list of points (name, y, z), from the top centre (y = 0) round the outside
  down to rail level. Points are joined by straight lines.
* Lengths of vehicles and track in m; profile coordinates, plays, wear and tolerances in mm; radii in m;
  cant in mm; speed in km/h; angles in rad inside the engine (degrees allowed at the input boundary).
* A horizontal curve is to the **left** or **right**; the inside of the curve is the side towards its
  centre. Vertical curve radius `R_v` > 0 is a **crest** (hump), `R_v` < 0 a **sag** (hollow).
* Movements are counted positive when they **reduce clearance** (outwards laterally, upwards for
  upper parts, downwards for lower parts).

## 3. Inputs

### 3.1 Train configuration (tab *Train Configuration*)

| Symbol | Input | Unit |
|---|---|---|
| — | Train name, customer / line, formation (e.g. `DMC-TC-MC-MC-TC-DMC`), number of cars | — |
| `l_nom` | Nominal track gauge | mm |
| *L* | Distance between rail running circles (1500 for 1435 mm gauge) | mm |
| `V_max` | Maximum vehicle speed | km/h |
| — | Bogie arrangement: **non-shared** (two bogies per car) or **shared** (Jacobs bogies between cars) | — |
| — | Primary and secondary suspension type; power supply (third rail / overhead / none) | — |
| — | Load conditions: **tare** (highest body, used for upper parts) and **laden** (lowest body, used for lower parts); labels such as AW0 / AW4 | — |

Per **car type** (DMC, TC, MC …): count, length over body, bogie centre distance *a*, overhang
beyond the bogie centre at each end `n_a,1` / `n_a,2`, maximum body width, floor height,
roof height, tare and laden mass, centre of gravity height tare / laden, bogie type at each end.

For **shared** bogies, *a* is the distance between the articulation (bogie) centres that carry the
body, and the overhang of an intermediate car is normally 0.

### 3.2 Car body and bogie inputs (tab *Car body & Bogie*)

Per **bogie type** (e.g. motor M, trailer T):

| Symbol | Input | Unit |
|---|---|---|
| *p* | Bogie wheelbase | m |
| `D_new`, `D_worn` | Wheel diameter new / fully worn | mm |
| *d* | Dimension over wheel flanges, minimum (worn), measured 10 mm below the tread | mm |
| *q* | Primary (axle box) lateral play each side, wheelset to bogie frame | mm |
| *w* | Secondary lateral displacement each side, bogie to body, up to the hard stop (free play + bump stop) | mm |
| `w_i`(R), `w_a`(R) | Secondary lateral displacement towards the inside / outside of a curve (if different from *w*) | mm |
| Δ`z_p` | Primary vertical: static deflection tare→laden, dynamic deflection, rebound | mm |
| Δ`z_s` | Secondary vertical: tare→laden deflection, dynamic, rebound, air spring deflated drop, over-inflation | mm |
| `h_p` | Height of the bogie frame reference above rail (for bogie-mounted parts) | mm |

Per **car type** (car body):

| Symbol | Input | Unit |
|---|---|---|
| *s* | Flexibility (souplesse) coefficient, tare / laden | — |
| `h_c` | Roll centre height above rail | mm |
| `η_0` | Asymmetry (dissymmetry) angle: suspension adjustment, load offset, construction | deg |
| `θ_w` | Body roll under the design wind (or wind force `F_w`, its height `h_w` and roll stiffness `k_φ`) | deg |
| `f_sag`, `f_cam` | Mid-car vertical sag (laden) and camber (tare) of the body | mm |
| `t_y`, `t_z` | Body manufacturing tolerance lateral / vertical | mm |
| `y_dyn`, `z_dyn` | Dynamic (oscillation) allowance lateral / vertical from running dynamics | mm |

### 3.3 Customer KE and SOD (tab *Customer KE & SOD*)

* One or more **customer KE** profiles (e.g. ballasted, ballastless, tunnel), each a list of points
  (name, y, z). The KE is the space the vehicle in motion may occupy on the reference track
  condition stated by the customer.
* For the EN method: reference parameters of the associated rules — `s_0` (0.4), `h_c0`
  (500 mm), `D_0` / `I_0` (50 mm), overthrow allowance coefficient `C_k`
  (*k* = `C_k`/R) and the radius limits for which they apply **[verify]**.
* One or more **structure gauge / SOD** profiles (tunnel, elevated, at-grade …), plus point items
  such as third rail, platform edge, walkway or signal equipment (name, y, z, type), and the required
  minimum clearance (electrical or mechanical) for each item.
* Frame of the SOD: **track plane** (default) or **vertical** (then our KE is rotated by the cant
  angle before comparison, §9.3).

### 3.4 RS profile (tab *RS Profile*)

One or more static profiles, each with: name, car type it applies to (or `ALL`), **mounting level**
(`body`, `bogie`, `axle`) and points (name, y, z). Typical: car body outline, underframe equipment,
bogie frame, axle-mounted items. The mounting level decides which movements apply (§4.9).

### 3.5 Track data (tab *Track Data*)

Global track parameters: gauge widening rule, lateral alignment tolerance, vertical (level) tolerance,
cross-level tolerance, gauge tolerance, lateral and vertical rail wear (and whether rail wear is the
infrastructure's responsibility).

Segments, one row per track element: chainage from / to (m), element name, horizontal radius *R*
(0 = tangent), curve side (L/R), cant *E* (mm), vertical curve radius `R_v` (0 = none),
speed limit (km/h), section type (tunnel / elevated / at-grade / depot), track form (ballasted /
ballastless), SOD profile name and KE profile name for that segment, local gauge widening (mm).
Segments must be in increasing chainage and must not overlap; gaps are reported.

## 4. Displacement build-up (common to both methods)

Each displacement is evaluated for a cross-section at distance *n* from the nearest bogie centre:
*n* = `n_i` for a section **between** the bogie centres (0 ≤ `n_i` ≤ *a*/2), *n* = `n_a`
for a section **outside** them (overhang). Typical sections: car end, over the bogie centre, mid-car.

### 4.1 Horizontal geometric overthrow

For a body on two bogies of wheelbase *p* on a curve of radius *R* (UIC 505-1 / EN 15273-2 formula,
valid for *R* ≥ 150 m; below that the graphic method is required **[verify]**):

* inner section, displacement **towards the inside** of the curve:
  `d_gi = ( n_i·(a − n_i) + p²/4 ) / (2R)`
* outer (overhang) section, displacement **towards the outside** of the curve:
  `d_ga = ( n_a·(a + n_a) − p²/4 ) / (2R)`

(lengths in m, result in m, ×1000 for mm). On tangent track both are 0.

### 4.2 Lateral plays and yaw (bogie rotation) multiplier

Lateral play available at each bogie:

`j = (l − d)/2 + q + w`

with *l* = actual track gauge (nominal + widening + gauge tolerance, + lateral rail wear when it is
counted by the vehicle side) and *d* the minimum dimension over flanges. In curves *w* is replaced
by `w_i`(R) or `w_a`(R) when given.

Yaw multiplier (both bogies displaced in opposite directions):

* inner sections: `A_i = 1`
* outer sections: `A_a = (2·n_a + a) / a`

Lateral displacement from plays: `Δy_play = A · j`.

### 4.3 Quasi-static roll

The body rolls about the roll centre (0, `h_c`) by the angle

`θ_qs = s · D / L` (cant deficiency, body leans outwards) or `θ_qs = s · E / L` (cant excess, leans inwards)

with equilibrium cant `E_eq = L · v² / (g · R)` (v in m/s, *L* in mm; for *L* = 1500 mm,
`E_eq ≈ 11.8 · V² / R` with V in km/h), cant deficiency `D = max(0, E_eq − E)` and cant excess
`I = max(0, E − E_eq)` (at standstill `I = E`).

Total roll angle: `θ = θ_qs + η_0 + θ_w` (all in the same direction for the worst case).

For a profile point (y, z) on the side the body leans towards (small angles):

`Δy = θ · (z − h_c)`, `Δz = −θ · y`; on the opposite side `Δy = −θ·(z − h_c)`, `Δz = +θ·y`.

So roll increases the lateral displacement of points above `h_c`, lowers the leaning side and
raises the other side. The suspension limit (bump stops) caps the combined lateral body
displacement; if the cap is reached, the capped value is used and a warning is given **[verify]**.

### 4.4 Track tolerances

* Lateral alignment tolerance `t_ta`: `Δy = t_ta` (random).
* Cross-level tolerance `t_cl`: the track plane tilts by `t_cl / L` about the track centre at
  rail level and the suspension adds `s · t_cl / L` about the roll centre (random):
  `Δy = (t_cl/L)·z + s·(t_cl/L)·(z − h_c)`.
* Vertical tolerance `t_tv`: `Δz = t_tv` (random).

### 4.5 Vertical — lower parts (downward)

| Term | Body-mounted | Bogie-mounted | Axle-mounted |
|---|---|---|---|
| Wheel wear `(D_new − D_worn)/2` | ✓ | ✓ | ✓ |
| Primary deflection tare→laden + dynamic | ✓ | ✓ | — |
| Secondary deflection tare→laden + dynamic | ✓ | — | — |
| Air spring deflated drop (deflated condition only) | ✓ | — | — |
| Vertical rail wear (if vehicle side) | ✓ | ✓ | ✓ |
| Vertical curve, roll, pitch, sag (§4.7–4.8, §4.3) | ✓ | partly | — |

### 4.6 Vertical — upper parts (upward)

Tare condition, new wheels, plus primary and secondary rebound (dynamic), air spring over-inflation
(if specified), camber, vertical curve and roll (raised side).

### 4.7 Vertical curve overthrow

Same geometry as §4.1 with `R_v` and without the *p*²/4 term for a body on bogies **[verify]**:

* crest (`R_v` > 0): inner sections move **down** relative to the rail by `n_i·(a − n_i)/(2R_v)`
  (lower parts); outer sections move **up** by `n_a·(a + n_a)/(2R_v)` (upper parts).
* sag (`R_v` < 0): inner sections move **up** by `n_i·(a − n_i)/(2|R_v|)` (upper parts); outer
  sections move **down** by `n_a·(a + n_a)/(2|R_v|)` (lower parts).

### 4.8 Pitch, sag and camber

* Pitch: if the air springs of only one bogie are deflated (or vertical deflections differ between
  the two bogies by δ), an overhang section moves by `δ · (a + n_a)/a`; inner sections by at most δ.
* Sag / camber at an inner section: `f · 4·n_i·(a − n_i)/a²` (parabolic, maximum *f* at mid-car).

### 4.9 Mounting level

* **Body**: all terms.
* **Bogie** (frame-mounted): overthrow with *p* only (the bogie frame chord), plays `(l − d)/2 + q`
  (no *w*, no body yaw multiplier), roll of the bogie on the primary suspension only (entered as an
  equivalent `s_bogie`, default 0), primary vertical terms.
* **Axle** (unsprung): `(l − d)/2`, wheel wear, rail wear, track tolerances.

## 5. Combination rule

Movements are split into:

* **Deterministic (quasi-static) terms** — overthrow, plays, quasi-static roll, wind, asymmetry,
  suspension deflections, wear, vertical curve, pitch, sag/camber. Added **linearly**.
* **Random terms** — track tolerances, body manufacturing tolerances, suspension adjustment
  tolerances, dynamic oscillation allowances. Combined by **RSS** `√(Σ r_k²)` (default) or **linearly**
  (conservative option).

`Δ_total = Σ deterministic + combine(random) + safety margin`

Every term is reported separately so the build-up can be checked line by line.

## 6. Method A — Metro SOD-style

### 6.1 Forward (checking): our KE

For each car type, section, load condition (tare / laden), suspension condition (inflated / deflated)
and side, every point (y, z) of every applicable RS profile is moved by the build-up of §4–5:

`y_KE = y + Δy_total`, `z_KE = z + Δz_up` (upper parts) or `z − Δz_down` (lower parts),

where a point is an upper part if *z* ≥ `z_split` (default: floor height) and a lower part
otherwise. The KE is the outer envelope of all moved points over all cases.

### 6.2 Backward (define): maximum static profile

Each customer KE point is moved **inwards** by the same build-up evaluated at that point:

`y_max = y_KE − Δy_total`, `z_max = z_KE − Δz_up` (upper) or `z_KE + Δz_down` (lower).

The RS profile must lie inside the maximum static profile.

## 7. Method B — EN 15273-2 kinematic method

The reductions are subtracted from the reference profile (here: the customer KE treated as the
reference profile of its associated rules) to give the maximum construction gauge **[verify all of §7]**:

* inner sections: `E_i = (a·n_i − n_i² + p²/4)/(2R) + (l − d)/2 + q + w_i(R) + z − k`
* outer sections: `E_a = (a·n_a + n_a² − p²/4)/(2R) + [ (l − d)/2 + q + w_a(R) ]·(2n_a + a)/a + z − k`

with *k* = the overthrow already allowed in the reference profile (`k = C_k / R`, from the associated
rules) and *z* the quasi-static displacement **exceeding** the reference allowance:

`z = (s/L)·max(0, D − D_0)·(h − h_c) + (max(0, s − s_0)/L)·min(D, D_0)·max(0, h − h_c0)`

(and the same with *I*, `I_0` for the inside). Only positive reductions are applied. The
vertical reductions follow §4.5–4.7 minus the vertical allowances of the associated rules.

## 8. Static simulation (Phase 2)

Conditions set in the *Static Simulation* tab: method (A / B), customer KE profile, track condition
(tangent, or a design curve *R*, cant, cant deficiency / excess), load conditions, suspension
conditions, sections (car end, bogie centre, mid-car, user-defined *x*), combination rule, safety margin.

Outputs: our KE versus customer KE, maximum static profile versus RS profile, clearance at each
point, the governing case and the term-by-term build-up table. **Pass** when every clearance ≥ 0.

## 9. Dynamic simulation (Phase 3)

### 9.1 Per chainage
For every segment (or every Δx step inside long segments), the speed is
`V = min(speed limit, V_max)`; *D* and *I* follow from §4.3; the KE is built with that segment's
*R*, *E*, `R_v`, gauge widening and section type.

### 9.2 Inside and outside of the curve
On a curve the inside half uses `d_gi` and cant excess, the outside half `d_ga` and cant
deficiency; the left/right side of the SOD is matched to the curve side.

### 9.3 Frame
If the SOD is in the vertical frame, the KE is rotated by the cant angle `δ = asin(E/L)` about the low
rail before comparison.

### 9.4 Outputs
Minimum clearance versus chainage (lateral, vertical, to each point item), the cross-section at a
selected chainage (SOD, our KE, static profile), and the list of locations below the required clearance.

## 10. Clearance measurement

Clearance of a point P to a profile is the signed shortest distance from P to the profile polyline
(mirrored to the full profile): positive when P is inside the profile, negative when outside.
Lateral clearance at a height *z* and vertical clearance at an offset *y* are also reported.

## 11. Verification cases (tests, Phase 2)

1. Tangent, no movements: our KE = RS profile; maximum static profile = customer KE.
2. Overthrow: hand values of §4.1 for a = 15 m, p = 2.5 m, R = 300 m.
3. Roll: a point at (1500, 3500) with s = 0.3, D = 100 mm, `h_c` = 600 mm.
4. Forward then backward of the same build-up returns the original profile (round trip).
5. RSS versus linear combination on a known set of terms.
6. Symmetry: left and right curves give mirrored results.

## 12. Assumptions

1. Profiles are symmetric half-profiles; asymmetric equipment is entered as its own profile.
2. Small-angle approximation for roll (θ < 5°).
3. The geometric overthrow formula is used for *R* ≥ 150 m; smaller radii give a warning.
4. Shared (Jacobs) bogies are treated like two-bogie bodies with *a* = articulation centre distance;
   the restraint of the inter-car joint is neglected (conservative).
5. Quasi-static roll uses the flexibility coefficient *s* (measured in the static sway test) and a
   single roll centre height; non-linear bump-stop behaviour is represented by the cap of §4.3.
6. Wind is quasi-static and acts in the same direction as the cant deficiency.
7. Rail wear and track tolerances are counted on the vehicle side only when the customer's rules
   say so (switch in the Track Data tab).

## 13. Out of scope

Pantograph sway and catenary checks, platform gap (TSI-PRM / EN 16586) study, multi-body dynamic
simulation, coupled-train (rescue) gauging, and curves below 150 m by the graphic method — candidates
for later phases.
