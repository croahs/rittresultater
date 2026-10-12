"""Age classes in ten-year bands (Pedår, 2026-10-11): M 30-34 and M 35-39 are both M30-39.

Organizers use five- or ten-year bands as they like, so one rider can be M30-34 one week and
M30-39 the next. We count and show every age class in ten-year bands, so a rider's class means
the same in every race. Junior classes (under 20), open-ended ones (M70+) and anything that is
not a plain age band (M Senior, K 40-44/Elite) stay as the list has them."""
import re

_BAND = re.compile(r"^(?:master\s*)?([MK])\s*(?:master\s*)?(\d\d)\s*[-–]\s*(\d\d)$", re.I)


def decade(age_class):
    """"M 35-39" -> "M30-39", "K Master 60-64" -> "K60-69"; anything else unchanged.

    Only a class that lies inside one ten-year band is moved into it. One that crosses a band
    (M46-50, M26-30) or is wider than one (M30-49) stays as listed, so no rider gets a label
    for ages their class doesn't cover."""
    m = _BAND.match((age_class or "").strip())
    if not m:
        return age_class
    lo, hi = int(m.group(2)), int(m.group(3))
    band = lo // 10 * 10
    if lo < 20 or lo % 5 or hi < lo or hi > band + 9:
        return age_class
    return f"{m.group(1).upper()}{band}-{band + 9}"
