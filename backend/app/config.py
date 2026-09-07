from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ALPHAFX_", extra="ignore")

    env: str = "development"
    secret_key: str = "dev-secret-change-in-production"
    database_url: str = "sqlite:///./alphafx.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    seed_email: str = "faizan@alphafx.com"
    seed_password: str = "AlphaFX2026!"
    seed_name: str = "Faizan Ashfaque Quazi"
    admin_email: str = "admin@alphafx.com"
    admin_password: str = "AdminFX2026!"
    admin_name: str = "AlphaFX Admin"
    tick_hub_ws: str = ""
    tick_hub_http: str = "http://127.0.0.1:9003"
    tick_mock: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
