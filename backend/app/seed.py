import random
from datetime import datetime, timedelta, timezone

from .auth import hash_password
from .database import Base, SessionLocal, engine
from .models import (
    Category,
    Customer,
    Product,
    Sale,
    SaleItem,
    Supplier,
    User,
)


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(User).first():
            return

        db.add_all(
            [
                User(
                    name="Administrateur",
                    email="admin@reference.ci",
                    hashed_password=hash_password("admin123"),
                    role="admin",
                ),
                User(
                    name="Vendeur Démo",
                    email="vendeur@reference.ci",
                    hashed_password=hash_password("vendeur123"),
                    role="vendeur",
                ),
            ]
        )

        categories = [
            Category(name="Ordinateurs", description="PC portables et de bureau"),
            Category(name="Périphériques", description="Souris, claviers, écrans"),
            Category(name="Composants", description="Cartes, RAM, disques"),
            Category(name="Réseaux", description="Routeurs, switchs, câbles"),
            Category(name="Accessoires", description="Sacs, câbles, chargeurs"),
            Category(name="Impression", description="Imprimantes et consommables"),
        ]
        db.add_all(categories)
        db.flush()

        suppliers = [
            Supplier(name="TechDistrib CI", contact="Kouassi Yao", email="contact@techdistrib.ci", phone="+225 07 01 02 03", address="Abidjan, Plateau"),
            Supplier(name="Global Import", contact="Aminata Traoré", email="ventes@globalimport.com", phone="+225 05 04 05 06", address="Abidjan, Marcory"),
            Supplier(name="InfoStock SARL", contact="Jean Kouadio", email="info@infostock.ci", phone="+225 01 07 08 09", address="Abidjan, Cocody"),
        ]
        db.add_all(suppliers)
        db.flush()

        customers = [
            Customer(name="Sophie Martin", email="sophie.martin@gmail.com", phone="+225 07 11 22 33", address="Cocody, Angré"),
            Customer(name="Thomas Bernard", email="thomas.bernard@gmail.com", phone="+225 05 44 55 66", address="Plateau"),
            Customer(name="Julie Dubois", email="julie.dubois@gmail.com", phone="+225 01 77 88 99", address="Yopougon"),
            Customer(name="Marc Leroy", email="marc.leroy@gmail.com", phone="+225 07 12 34 56", address="Marcory"),
            Customer(name="Anna Petit", email="anna.petit@gmail.com", phone="+225 05 65 43 21", address="Treichville"),
            Customer(name="Entreprise Alpha", email="achats@alpha.ci", phone="+225 27 20 30 40", address="Zone 4"),
            Customer(name="Cabinet Beta", email="contact@beta.ci", phone="+225 27 21 31 41", address="Deux Plateaux"),
        ]
        db.add_all(customers)
        db.flush()

        products_data = [
            ("PC Portable Dell Latitude 5540", "PC-DELL-5540", 0, 0, 450000, 620000, 12, 3),
            ("PC Portable HP ProBook 450", "PC-HP-450", 0, 0, 380000, 540000, 8, 3),
            ("PC Bureau Lenovo ThinkCentre", "PC-LEN-TC", 0, 1, 320000, 450000, 6, 2),
            ("MacBook Air M2", "PC-APL-MBA", 0, 1, 780000, 990000, 4, 2),
            ("Écran Dell 24\" P2422H", "PER-DELL-24", 1, 0, 95000, 135000, 20, 5),
            ("Souris Logitech MX Master 3", "PER-LOG-MX3", 1, 1, 42000, 62000, 30, 8),
            ("Clavier mécanique Redragon", "PER-RED-KB", 1, 1, 28000, 42000, 25, 8),
            ("Webcam Logitech C920", "PER-LOG-C920", 1, 0, 45000, 68000, 15, 5),
            ("SSD Samsung 1TB NVMe", "COMP-SAM-1TB", 2, 2, 55000, 82000, 40, 10),
            ("Barrette RAM 16GB DDR4", "COMP-RAM-16", 2, 2, 32000, 48000, 35, 10),
            ("Carte graphique RTX 4060", "COMP-NV-4060", 2, 0, 280000, 380000, 5, 2),
            ("Routeur TP-Link Archer AX55", "RES-TPL-AX55", 3, 2, 48000, 72000, 18, 5),
            ("Switch Cisco 8 ports", "RES-CIS-8P", 3, 0, 65000, 95000, 10, 3),
            ("Câble réseau Cat6 (10m)", "RES-CBL-C6", 3, 2, 3500, 6000, 100, 20),
            ("Onduleur APC 650VA", "ACC-APC-650", 4, 1, 42000, 65000, 14, 4),
            ("Sacoche PC 15.6\"", "ACC-SAC-156", 4, 2, 8000, 15000, 45, 10),
            ("Chargeur USB-C 65W", "ACC-CHG-65", 4, 1, 12000, 22000, 22, 8),
            ("Imprimante HP LaserJet Pro", "IMP-HP-LJP", 5, 0, 145000, 210000, 7, 2),
            ("Cartouche toner HP 26A", "IMP-HP-26A", 5, 0, 38000, 58000, 16, 6),
            ("Multifonction Canon Pixma", "IMP-CAN-PIX", 5, 2, 62000, 92000, 3, 4),
        ]
        products = []
        for name, sku, cat, sup, pp, sp, qty, minst in products_data:
            p = Product(
                name=name,
                sku=sku,
                category_id=categories[cat].id,
                supplier_id=suppliers[sup].id,
                purchase_price=pp,
                sale_price=sp,
                quantity=qty,
                min_stock=minst,
                description="",
            )
            products.append(p)
        db.add_all(products)
        db.flush()

        # Generate sales across the last 6 months of the current year
        now = datetime.now(timezone.utc)
        payment_methods = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"]
        statuses = ["Payée", "Payée", "Payée", "En attente"]
        sale_counter = 0
        for month_offset in range(5, -1, -1):
            base = now - timedelta(days=30 * month_offset)
            num_sales = random.randint(6, 12)
            for _ in range(num_sales):
                sale_counter += 1
                sale_date = base - timedelta(days=random.randint(0, 25))
                cust = random.choice(customers)
                status = random.choice(statuses)
                sale = Sale(
                    reference=f"VNT-{now.year}-{sale_counter:04d}",
                    customer_id=cust.id,
                    date=sale_date,
                    status=status,
                    payment_method=random.choice(payment_methods),
                    total=0,
                )
                total = 0.0
                for _ in range(random.randint(1, 4)):
                    prod = random.choice(products)
                    q = random.randint(1, 3)
                    subtotal = prod.sale_price * q
                    total += subtotal
                    sale.items.append(
                        SaleItem(
                            product_id=prod.id,
                            product_name=prod.name,
                            quantity=q,
                            unit_price=prod.sale_price,
                            subtotal=subtotal,
                        )
                    )
                sale.total = total
                db.add(sale)

        db.commit()
        print("Base de données initialisée avec des données de démonstration.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
