from typing import Annotated

from pydantic import Field


Quantity = Annotated[float, Field(allow_inf_nan=False, multiple_of=0.000001)]


def round_quantity(value):
    return round(float(value or 0), 6)
