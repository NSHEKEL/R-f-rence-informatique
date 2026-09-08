"""Central licensing service: plans, features, clients, licences, installations.

It runs apart from the shop application: the software installed at a client
never touches this database, it only talks to the HTTPS API of this service.
"""
