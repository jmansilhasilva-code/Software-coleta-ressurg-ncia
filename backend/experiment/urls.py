from rest_framework.routers import DefaultRouter

from .views import ParticipantViewSet, SessionViewSet

router = DefaultRouter()
router.register(r"sessions", SessionViewSet, basename="session")
router.register(r"participants", ParticipantViewSet, basename="participant")

urlpatterns = router.urls
