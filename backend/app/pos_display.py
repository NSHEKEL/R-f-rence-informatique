import json

from pydantic import BaseModel, Field
from typing import Literal


class PosDisplay(BaseModel):
    mode: Literal['nom', 'nom+prix', 'nom+prix+stock', 'image+nom+prix', 'image+nom+prix+stock'] = 'nom'
    width: int = Field(default=160, ge=100, le=400)
    height: int = Field(default=110, ge=70, le=400)
    font_size: int = Field(default=16, ge=10, le=36)
    font_family: Literal['Arial', 'Verdana', 'Tahoma', 'Georgia', 'sans-serif'] = 'Arial'
    columns: int = Field(default=0, ge=0, le=12)
    gap_x: int = Field(default=12, ge=0, le=40)
    gap_y: int = Field(default=12, ge=0, le=40)
    align: Literal['left', 'center', 'right'] = 'center'
    background: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    text: str = Field(default='#1e293b', pattern=r'^#[0-9a-fA-F]{6}$')
    border: str = Field(default='#e2e8f0', pattern=r'^#[0-9a-fA-F]{6}$')
    radius: int = Field(default=10, ge=0, le=40)
    images: bool = False
    stock: bool = False


def read_display(settings):
    try:
        return PosDisplay.model_validate(json.loads(settings.pos_display or '{}'))
    except (ValueError, TypeError):
        return PosDisplay()
