"""Age classes in ten-year bands (Pedår, 2026-10-11): M 30-34 and M 35-39 are both M30-39.

Organizers use five- or ten-year bands as they like, so one rider can be M30-34 one week and
M30-39 the next. We count and show every age class in ten-year bands, so a rider's class means
the same in every race. Junior classes (under 20), open-ended ones (M70+) and anything that is
not a plain age band (M Senior, K 40-44/Elite) stay as the list has them."""
import re

_BAND = re.compile(r"^([MK])\s*(?:master\s*)?(\d\d)\s*[-–]\s*(\d\d)$", re.I)


def decade(age_class):
    """"M 35-39" -> "M30-39", "K Master 60-64" -> "K60-69"; anything else unchanged."""
    m = _BAND.match((age_class or "").strip())
    if not m or int(m.group(2)) < 20:
        return age_class
    lo = int(m.group(2)) // 10 * 10
    return f"{m.group(1).upper()}{lo}-{lo + 9}"
