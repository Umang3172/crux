"""Learning across sites: a lesson memory that grows from every confirmed case,
specialist packs per machine type, and signed updates from a hub that each site
tests on its own failures before a person installs them. Nothing here moves an
investigation's beliefs."""

from .hub import Hub
from .memory import Lesson, Memory
from .packs import PACKS, machine_type_of
from .site import Site

__all__ = ["PACKS", "Hub", "Lesson", "Memory", "Site", "machine_type_of"]
