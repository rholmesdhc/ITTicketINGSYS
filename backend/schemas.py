from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ClinicSiteBase(BaseModel):
    name: str

class ClinicSiteCreate(ClinicSiteBase):
    pass

class ClinicSiteResponse(ClinicSiteBase):
    id: int
    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

class UserBase(BaseModel):
    username: str
    role: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    mi: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    clinic_site_id: Optional[int] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    role: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    mi: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    clinic_site_id: Optional[int] = None

class TicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: str
    asset_id: Optional[int] = None

class TicketUpdate(BaseModel):
    status: Optional[str] = None
    tech_id: Optional[int] = None

class TicketResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    category: str
    priority: str
    created_at: datetime
    updated_at: datetime
    sla_deadline: Optional[datetime]
    requester_id: int
    tech_id: Optional[int]
    asset_id: Optional[int]

    class Config:
        from_attributes = True
