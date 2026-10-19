from datetime import date as Date
from decimal import Decimal
from typing import Literal

import pycountry
from pydantic import BaseModel, ConfigDict, Field, field_validator

CATEGORIES = ['Meals & drinks', 'Travel', 'Office supplies', 'Software', 'Shopping', 'Utilities', 'Other']
Category = Literal['Meals & drinks', 'Travel', 'Office supplies', 'Software', 'Shopping', 'Utilities', 'Other']
Money = Decimal


class LineItem(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    description: str = Field(min_length=1, max_length=200)
    quantity: Decimal | None = Field(default=None, gt=0, le=100000)
    amount: Money | None = Field(default=None, ge=0, le=100000000, max_digits=14, decimal_places=3)


class ReceiptFields(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    merchant: str | None = Field(default=None, max_length=160)
    date: Date | None = None
    currency: str | None = None
    subtotal: Money | None = Field(default=None, ge=0, le=100000000, max_digits=14, decimal_places=3)
    tax: Money | None = Field(default=None, ge=0, le=100000000, max_digits=14, decimal_places=3)
    total: Money | None = Field(default=None, ge=0, le=100000000, max_digits=14, decimal_places=3)
    category: Category = 'Other'
    notes: str = Field(default='', max_length=2000)
    line_items: list[LineItem] = Field(default_factory=list, max_length=100)

    @field_validator('currency')
    @classmethod
    def valid_currency(cls, value):
        if value is None or not value.strip():
            return None
        value = value.upper()
        if pycountry.currencies.get(alpha_3=value) is None:
            raise ValueError('Use a valid ISO 4217 currency code, such as USD or LKR.')
        return value

    @field_validator('merchant')
    @classmethod
    def blank_merchant(cls, value):
        return value or None


class Correction(ReceiptFields):
    status: Literal['needs_review', 'verified'] = 'needs_review'


def review_warnings(fields: ReceiptFields) -> list[str]:
    warnings = []
    for name in ('merchant', 'date', 'currency', 'total'):
        if getattr(fields, name) is None:
            warnings.append(f'Missing {name}. Please check the receipt.')
    if fields.date and fields.date > Date.today():
        warnings.append('Receipt date is in the future.')
    if all(getattr(fields, n) is not None for n in ('subtotal', 'tax', 'total')):
        if abs(fields.subtotal + fields.tax - fields.total) > Decimal('0.02'):
            warnings.append('Subtotal plus tax does not match total. Check discounts, tips or fees.')
    if fields.total is not None and fields.tax is not None and fields.tax > fields.total:
        warnings.append('Tax is greater than total.')
    return warnings
