# Builds tests/fixtures/workbook-reference.json: FICTIONAL inputs are written into a copy of the owner's gauging
# workbook ("Vehicle Gauging Calculation Tool", NOT in this repository), recalculated by LibreOffice for several
# option sets, and the workbook's own results are stored next to the inputs. tests/workbook.test.js then checks
# that js/engine.js gives the same numbers. Dev aid only (needs openpyxl and LibreOffice).
#   python tools/workbook-reference.py <path to the workbook .xlsx>
import json, os, subprocess, sys, tempfile, copy
import openpyxl

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
src = sys.argv[1]
sample = json.load(open(os.path.join(root, 'samples/sample-project.json')))

# one car type with identical bogies (the workbook models one car and one bogie type)
car = copy.deepcopy([c for c in sample['train']['carTypes'] if c['name'] == 'MC'][0])
bog = copy.deepcopy([b for b in sample['bogies'] if b['name'] == 'M'][0])
body = copy.deepcopy([b for b in sample['bodies'] if b['car'] == 'MC'][0])
ke = copy.deepcopy(sample['ke']['profiles'][0])
ke2 = copy.deepcopy(sample['ke']['profiles'][1])
segs = copy.deepcopy(sample['track']['segments'])
roof, hvac = [copy.deepcopy(p) for p in sample['rs']['profiles']]
tp = copy.deepcopy(sample['track']['params']); lim = copy.deepcopy(sample['ke']['limits']); tr = sample['train']

L_ARR = {'non_shared': 'Non-shared (2 own bogies)', 'shared_one': 'Shared bogie at one end (semi-articulated pair)', 'shared_both': 'Shared bogies at both ends (articulated)'}
YN = {'yes': 'Yes', 'no': 'No'}
SUSP = {'inflated': 'Inflated (normal)', 'deflated': 'Deflated (abnormal)'}
VARIANTS = [
    ('base', {}, {}),
    ('rss', {'comb': 'rss', 'K_rss': 1.2}, {}),
    ('deflated', {'lat_state': 'deflated', 'vert_state': 'inflated', 'over_infl': 'yes'}, {}),
    ('theoretical', {'flex': 'theoretical', 'latflex': 'no'}, {}),
    ('random_terms', {'gtol_ext': 'yes', 'align': 'yes', 'tilt': 'yes', 'up_roll': 'yes', 'wind': 'no'}, {}),
    ('static_curve', {}, {'R_static_m': 300, 'Rv_static_m': 2000}),
    ('shared_one_end', {'flex': 'theoretical'}, {'arr': 'shared_one', 'n_art_m': 0.3}),
]
BASE_OPT = dict(sample['settings']['static'])
DYN_BASE = {'ov_meth': 'max', 'load': 'tare', 'profile': '', 'ss_R_m': 1000, 'ss_cant_mm': 75, 'ss_wind_kmh': 60, 'ss_step_kmh': 10, 'ss_n': 13, 'ss_ke': 'KE Ballastless', 'xs_ch': None}
DYN_VARIANTS = [
    ('dyn_base', {}, {}),
    ('dyn_local_crush_rss', {'comb': 'rss', 'K_rss': 1.3}, {'ov_meth': 'local', 'load': 'crush', 'xs_ch': 1990}),
    ('dyn_deflated_terms', {'lat_state': 'deflated', 'vert_state': 'inflated', 'gtol_ext': 'yes', 'align': 'yes', 'tilt': 'yes'}, {'ss_R_m': 300, 'ss_cant_mm': 110, 'ss_ke': 'KE Ballasted', 'xs_ch': 620}),
    ('dyn_theoretical_nowind', {'flex': 'theoretical', 'wind': 'no'}, {'xs_ch': 4300}),
]
KE_SLOT = {'KE Ballastless': 'Reference Bid – Ballast-less', 'KE Ballasted': 'Reference Bid – Ballasted'}
LOC = {'open': 'Open', 'tunnel': 'Tunnel', 'platform': 'Platform', 'depot': 'Depot'}
EL = {'tangent': 'Tangent', 'transition': 'Transition', 'circular': 'Circular'}

def write_dyn(wb, dopt):
    md, td, go = wb['Main Data'], wb['Track Data'], wb['Dynamic Gauge Output']
    md['B13'] = 'Reference Bid – Roof section'
    md['B25'] = 'Local radius (formula)' if dopt['ov_meth'] == 'local' else 'Max curvature within car length (conservative)'
    md['B26'] = 'Crush (AW4)' if dopt['load'] == 'crush' else 'Tare (AW0)'
    md['B27'] = KE_SLOT[dopt['ss_ke']]
    md['B66'] = tp['dx_m']; md['B68'] = dopt['ss_R_m']; md['B69'] = dopt['ss_cant_mm']; md['B70'] = dopt['ss_wind_kmh']; md['B71'] = dopt['ss_step_kmh']
    go['G37'] = dopt['xs_ch']
    for r in range(7, 407):
        for c in range(2, 19):
            td.cell(r, c).value = None
    for i, sg in enumerate(segs):
        r = 7 + i
        vals = [sg['from_m'], sg['to_m'], None, EL[sg['element']], sg['side'] or '-', sg['R_start_m'], sg['R_end_m'], sg['cant_start_mm'], sg['cant_end_mm'],
                sg['speed_kmh'], sg['Rv_m'], KE_SLOT[sg['ke']], LOC[sg['location']], sg['wind'], sg['struct_mm'], sg['platform_mm'], sg['platform_side'] or None]
        for j, v in enumerate(vals):
            if j == 2:
                continue   # length is a formula
            td.cell(r, 2 + j).value = v
        td.cell(r, 4).value = '=IF(B%d="","",C%d-B%d)' % (r, r, r)
    kp = wb['KE & Profiles']
    kp['C7'] = ke2['n_up']
    for i in range(20):
        q = ke2['points'][i] if i < len(ke2['points']) else None
        kp['B%d' % (10 + i)] = q['y'] / 1000 if q else None
        kp['C%d' % (10 + i)] = q['z'] / 1000 if q else None

SW_COLS = ['B', 'C', 'F', 'I', 'R', 'T', 'V', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AQ', 'AS', 'AT', 'AW', 'AX', 'BB', 'BC']
def read_dyn(path):
    w = openpyxl.load_workbook(path, data_only=True)
    dc, go = w['Dynamic Calc'], w['Dynamic Gauge Output']
    rows = []
    for r in range(42, 2042):
        row = [dc['%s%d' % (c, r)].value for c in SW_COLS]
        rows.append(row)
        if row[-1] == 0:
            break   # first row beyond the end (end chainage, not valid)
    ss = [[dc.cell(r, c).value for c in range(1, 17)] for r in range(25, 38)]
    xs = {n: dc['C%d' % r].value for n, r in (('ch', 2047), ('def', 2055), ('exc', 2056), ('Dw', 2057), ('wd', 2058), ('dgi', 2059), ('dga', 2060), ('To', 2063), ('Ti', 2064),
                                              ('phi', 2066), ('tho', 2067), ('thi', 2068), ('o2', 2069), ('i2', 2070))}
    xs['outline'] = [[dc['%s%d' % (c, r)].value for c in ('B', 'C', 'F', 'G', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q')] for r in range(2075, 2115)]
    summ = [go['D%d' % r].value for r in range(6, 17)] + [go['F%d' % r].value for r in range(8, 16)]
    el = [[go.cell(r, c).value for c in range(1, 17)] for r in range(88, 88 + len(segs))]
    return {'cols': SW_COLS, 'rows': rows, 'speedStep': ss, 'xs': xs, 'summary': summ, 'elements': el}

def write(wb, opt, extra):
    md, cb, bi, kp = wb['Main Data'], wb['Carbody Inputs'], wb['Bogie Inputs'], wb['KE & Profiles']
    t = dict(tp); t.update({k: v for k, v in extra.items() if k in tp})
    arr = extra.get('arr', 'non_shared')
    md['B7'] = 'Metro'; md['B8'] = L_ARR[arr]; md['B9'] = 'Reference Bid – Ballast-less'
    md['B10'] = 'Reference Bid – Roof section'; md['B11'] = 'Reference Bid – HVAC section'; md['B12'] = 'Reference Bid – Roof section'
    md['B14'] = 'Theoretical (Bogie Inputs)' if opt['flex'] == 'theoretical' else 'Specified (Bogie Inputs)'
    md['B15'] = YN[opt['latflex']]; md['B16'] = SUSP[opt['lat_state']]; md['B17'] = SUSP[opt['vert_state']]
    md['B18'] = 'Statistical (RSS of random terms)' if opt['comb'] == 'rss' else 'Linear (all terms added)'
    for cell, k in (('B19', 'gtol_ext'), ('B20', 'align'), ('B21', 'tilt'), ('B22', 'up_roll'), ('B23', 'wind'), ('B24', 'over_infl')):
        md[cell] = YN[opt[k]]
    G = lambda ws, row, v: ws.cell(row, 7, v)
    for row, v in ((32, tr['vmax_kmh']), (33, t['cant_max_mm']), (34, t['cantdef_max_mm']), (35, t['cantexc_max_mm']), (36, t['wind_open_kmh']), (37, t['wind_plat_kmh']),
                   (39, tr['gauge_mm']), (40, tr['L_mm']), (41, t['g_tol_mm']), (42, t['fw_mm']), (43, t['align_tol_mm']), (44, t['cl_err_mm']), (45, t['widen_mm']), (46, t['widen_R_m']),
                   (47, t['R_min_m']), (48, t['R_static_m']), (49, t['Rv_static_m']), (51, lim['uf_min_body_mm']), (52, lim['uf_min_bog_mm']), (53, lim['axle_lim_t']), (54, lim['prm_gap_mm']),
                   (55, lim['nosing_mm']), (59, opt['K_rss']), (61, lim['h_ref1_mm'] / 1000), (62, lim['h_ref2_mm'] / 1000)):
        G(md, row, v)
    c = dict(car); c.update({k: v for k, v in extra.items() if k in car})
    for row, v in ((7, c['length_m']), (8, c['n_free_m']), (9, c['n_art_m']), (10, c['width_mm'] / 2000), (12, c['na_m']), (21, c['mass_tare_t'] * 1000), (22, c['mass_crush_t'] * 1000),
                   (23, bog['mass_t'] * 1000), (24, bog['n_axle']), (25, c['cg_tare_mm'] / 1000), (26, c['cg_crush_mm'] / 1000), (27, c['drop_crush_mm']), (29, c['length_m']),
                   (30, body['wind_top_mm'] / 1000), (31, body['wind_bot_mm'] / 1000), (32, body['Cf']), (33, tr['rho_air']), (34, tr['Beq_mm']), (42, body['uf_h_mm']), (43, body['uf_hw_mm'] / 1000),
                   (44, body['uf_bog_h_mm']), (45, c['floor_mm'] / 1000), (46, c['sill_hw_mm'] / 1000)):
        G(cb, row, v)
    b = bog
    for row, v in ((7, b['p_m']), (8, b['play_ld_mm']), (9, b['q_mm']), (10, b['w_mm']), (11, b['w_defl_mm']), (14, b['wheel_new_mm']), (15, b['wheel_worn_mm']), (16, b['pack_step_mm']),
                   (18, b['dn_prim_mm']), (19, b['dn_sec_inf_mm']), (20, b['dn_sec_def_mm']), (21, b['up_prim_mm']), (22, b['up_sec_mm']), (23, b['up_oi_mm']),
                   (27, body['s_tare']), (28, body['s_crush']), (29, body['s_defl']), (30, body['hc_tare_mm'] / 1000), (31, body['hc_crush_mm'] / 1000), (32, body['hc_defl_mm'] / 1000),
                   (34, b['kz_prim']), (35, b['n_ps']), (36, b['b1_mm'] / 1000), (37, b['z_prim_mm'] / 1000), (38, b['kz2_t']), (39, b['kz2_c']), (40, b['kz_em']), (41, b['n_as']),
                   (42, b['b2_mm'] / 1000), (43, b['k_arb']), (44, b['z_sec_mm'] / 1000), (45, b['z_sec_d_mm'] / 1000), (46, b['ky_prim']), (47, b['ky_sec']), (48, b['ky2_d'])):
        G(bi, row, v)
    def pts(col_x, col_h, r0, n, points):
        for i in range(n):
            p = points[i] if i < len(points) else None
            kp['%s%d' % (col_x, r0 + i)] = p['y'] / 1000 if p else None
            kp['%s%d' % (col_h, r0 + i)] = p['z'] / 1000 if p else None
    kp['O7'] = ke['n_up']; pts('N', 'O', 10, 20, ke['points'])
    pts('B', 'C', 36, 20, roof['points']); pts('N', 'O', 36, 20, hvac['points'])

def read(path):
    w = openpyxl.load_workbook(path, data_only=True)
    sc, bi, cb = w['Static Calc'], w['Bogie Inputs'], w['Carbody Inputs']
    return {
        'min': [sc.cell(32, c).value for c in range(3, 9)], 'pt': [sc.cell(33, c).value for c in range(3, 9)],
        'T': [sc.cell(16, c).value for c in range(3, 9)], 'thtot': [sc.cell(27, c).value for c in range(3, 9)],
        'methodA': [[sc.cell(r, c).value for c in (1, 2, 9, 10, 11, 15, 16, 17)] for r in range(186, 217)],
        'vertical': [sc.cell(r, 5).value for r in (221, 222, 223)] + [sc.cell(r, 3).value for r in (224, 225, 226, 227)],
        'theo_hc': [bi.cell(62, c).value for c in (4, 5, 6)], 'theo_s': [bi.cell(64, c).value for c in (4, 5, 6)],
        's_used': [bi.cell(69, 4).value, bi.cell(69, 5).value], 'hc_used': [bi.cell(70, 4).value, bi.cell(70, 5).value],
        'Cw': [cb['H36'].value, cb['H37'].value], 'axle_t': cb['H53'].value, 'width_loss': cb['H59'].value, 'a': cb['H15'].value,
    }

out = {'note': 'FICTIONAL inputs recalculated by the reference gauging workbook (LibreOffice). Generated by tools/workbook-reference.py.',
       'car': car, 'bogie': bog, 'body': body, 'ke': ke, 'ke2': ke2, 'segments': segs, 'profiles': [roof, hvac], 'track': tp, 'limits': lim,
       'train': {k: tr[k] for k in ('vmax_kmh', 'gauge_mm', 'L_mm', 'rho_air', 'Beq_mm')}, 'variants': []}
tmp = tempfile.mkdtemp()
for name, oo, extra in VARIANTS:
    opt = dict(BASE_OPT); opt.update(oo)
    wb = openpyxl.load_workbook(src)
    write(wb, opt, extra)
    fin = os.path.join(tmp, name + '.xlsx'); wb.save(fin)
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', os.path.join(tmp, 'out'), fin],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    res = read(os.path.join(tmp, 'out', name + '.xlsx'))
    out['variants'].append({'name': name, 'options': opt, 'extra': extra, 'expected': res})
    print(name, [round(v, 3) for v in res['min']], res['pt'])
out['dynamic'] = []
for name, oo, dd in DYN_VARIANTS:
    opt = dict(BASE_OPT); opt.update(oo)
    dopt = dict(DYN_BASE); dopt.update(dd)
    wb = openpyxl.load_workbook(src)
    write(wb, opt, {}); write_dyn(wb, dopt)
    fin = os.path.join(tmp, name + '.xlsx'); wb.save(fin)
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', os.path.join(tmp, 'out'), fin],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    res = read_dyn(os.path.join(tmp, 'out', name + '.xlsx'))
    out['dynamic'].append({'name': name, 'options': opt, 'dynamic': dopt, 'expected': res})
    print(name, len(res['rows']), 'rows; summary', [round(v, 2) if isinstance(v, float) else v for v in res['summary'][:11]])
dst = os.path.join(root, 'tests/fixtures/workbook-reference.json')
os.makedirs(os.path.dirname(dst), exist_ok=True)
def rnd(v):
    if isinstance(v, float):
        return float('%.12g' % v)
    if isinstance(v, list):
        return [rnd(x) for x in v]
    if isinstance(v, dict):
        return {k: rnd(x) for k, x in v.items()}
    return v
json.dump(rnd(out), open(dst, 'w'), separators=(',', ':'))
print('wrote', dst)
