
class ControllerError(Exception):
    """Base class for errors raised by application controllers."""


class ValidationError(ControllerError):
    """The supplied domain data is invalid."""


class NotFoundError(ControllerError):
    """The requested domain object does not exist."""


class ConflictError(ControllerError):
    """The requested change conflicts with an existing object."""


class PersistenceError(ControllerError):
    """A domain object could not be read from or written to storage."""


class ExternalServiceError(ControllerError):
    """An external service request failed."""
