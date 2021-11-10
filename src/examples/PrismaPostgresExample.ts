/*
 * docker run --name ts-sql-query-postgres -p 5432:5432 -e POSTGRES_PASSWORD=mysecretpassword -d postgres
 */

import { Table } from "../Table"
import { assertEquals } from "./assertEquals"
import { ConsoleLogQueryRunner } from "../queryRunners/ConsoleLogQueryRunner"
import { PostgreSqlConnection } from '../connections/PostgreSqlConnection'
import { PrismaClient } from './prisma/generated/postgresql'
import { PrismaQueryRunner } from "../queryRunners/PrismaQueryRunner"

class DBConection extends PostgreSqlConnection<'DBConnection'> {
    increment(i: number) {
        return this.executeFunction('increment', [this.const(i, 'int')], 'int', 'required')
    }
    appendToAllCompaniesName(aditional: string) {
        return this.executeProcedure('append_to_all_companies_name', [this.const(aditional, 'string')])
    }
    customerSeq = this.sequence('customer_seq', 'int')
}

const tCompany = new class TCompany extends Table<DBConection, 'TCompany'> {
    id = this.autogeneratedPrimaryKey('id', 'int');
    name = this.column('name', 'string');
    constructor() {
        super('company'); // table name in the database
    }
}()

const tCustomer = new class TCustomer extends Table<DBConection, 'TCustomer'> {
    id = this.autogeneratedPrimaryKeyBySequence('id', 'customer_seq', 'int');
    firstName = this.column('first_name', 'string');
    lastName = this.column('last_name', 'string');
    birthday = this.optionalColumn('birthday', 'localDate');
    companyId = this.column('company_id', 'int');
    constructor() {
        super('customer'); // table name in the database
    }
}()

const prisma = new PrismaClient()

async function main() {
    const connection = new DBConection(new ConsoleLogQueryRunner(new PrismaQueryRunner(prisma, {interactiveTransactions: true})))
    // Long running transactions are not supported by Prisma. See https://github.com/prisma/prisma/issues/1844
    //await connection.beginTransaction()

    try {
        await connection.queryRunner.executeDatabaseSchemaModification(`drop table if exists customer`)
        await connection.queryRunner.executeDatabaseSchemaModification(`drop table if exists company`)
        await connection.queryRunner.executeDatabaseSchemaModification(`drop sequence if exists customer_seq`)
        await connection.queryRunner.executeDatabaseSchemaModification(`drop function if exists increment`)
        await connection.queryRunner.executeDatabaseSchemaModification(`drop procedure if exists append_to_all_companies_name`)

        await connection.queryRunner.executeDatabaseSchemaModification(`
            create table company (
                id serial primary key,
                name varchar(100) not null
            )
        `)

        await connection.queryRunner.executeDatabaseSchemaModification(`
            create table customer (
                id integer primary key,
                first_name varchar(100) not null,
                last_name varchar(100) not null,
                birthday date,
                company_id integer not null references company(id)
            )
        `)

        await connection.queryRunner.executeDatabaseSchemaModification(`create sequence customer_seq`)

        await connection.queryRunner.executeDatabaseSchemaModification(`
            create function increment(i integer) returns integer AS $$
                begin
                    return i + 1;
                end;
            $$ language plpgsql
        `)

        await connection.queryRunner.executeDatabaseSchemaModification(`
            create procedure append_to_all_companies_name(aditional varchar) as $$
                update company set name = name || aditional;
            $$ language sql
        `)

        let i = await connection
            .insertInto(tCompany)
            .values({ name: 'ACME' })
            .returningLastInsertedId()
            .executeInsert()
        assertEquals(i, 1)

        i = await connection
            .insertInto(tCompany)
            .values({ name: 'FOO' })
            .executeInsert()
        assertEquals(i, 1)

        let [ii, iii] = await connection.transaction(() => [
            connection
                .insertInto(tCustomer)
                .values([
                    { firstName: 'John', lastName: 'Smith', companyId: 1 },
                    { firstName: 'Other', lastName: 'Person', companyId: 1 },
                    { firstName: 'Jane', lastName: 'Doe', companyId: 1 }
                ])
                .returningLastInsertedId()
                .executeInsert(),
            connection
                .selectFromNoTable()
                .selectOneColumn(connection.customerSeq.currentValue())
                .executeSelectOne()
        ])
        assertEquals(ii, [1, 2, 3])
        assertEquals(iii, 3)

        let company = await connection
            .selectFrom(tCompany)
            .where(tCompany.id.equals(1))
            .select({
                id: tCompany.id,
                name: tCompany.name
            })
            .executeSelectOne()
        assertEquals(company, { id: 1, name: 'ACME' })

        let companies = await connection
            .selectFrom(tCompany)
            .select({
                id: tCompany.id,
                name: tCompany.name
            })
            .orderBy('id')
            .executeSelectMany()
        assertEquals(companies, [{ id: 1, name: 'ACME' }, { id: 2, name: 'FOO' }])

        let name = await connection
            .selectFrom(tCompany)
            .where(tCompany.id.equals(1))
            .selectOneColumn(tCompany.name)
            .executeSelectOne()
        assertEquals(name, 'ACME')

        let names = await connection
            .selectFrom(tCompany)
            .selectOneColumn(tCompany.name)
            .orderBy('result')
            .executeSelectMany()
        assertEquals(names, ['ACME', 'FOO'])

        i = await connection
            .insertInto(tCompany)
            .from(
                connection
                .selectFrom(tCompany)
                .select({
                    name: tCompany.name.concat(' 2')
                })
            )
            .executeInsert()
        assertEquals(i, 2)

        names = await connection
            .selectFrom(tCompany)
            .selectOneColumn(tCompany.name)
            .orderBy('result')
            .executeSelectMany()
        assertEquals(names, ['ACME', 'ACME 2', 'FOO', 'FOO 2'])

        const fooComanyNameLength = connection
            .selectFrom(tCompany)
            .selectOneColumn(tCompany.name.length())
            .where(tCompany.id.equals(2))
            .forUseAsInlineQueryValue()

        companies = await connection
            .selectFrom(tCompany)
            .select({
                id: tCompany.id,
                name: tCompany.name
            })
            .where(tCompany.name.length().greaterThan(fooComanyNameLength))
            .orderBy('id')
            .executeSelectMany()
        assertEquals(companies, [{ id: 1, name: 'ACME' },{ id: 3, name: 'ACME 2' }, { id: 4, name: 'FOO 2'}])

        i = await connection
            .update(tCompany)
            .set({
                name: tCompany.name.concat(tCompany.name)
            })
            .where(tCompany.id.equals(2))
            .executeUpdate()
        assertEquals(i, 1)

        name = await connection
            .selectFrom(tCompany)
            .where(tCompany.id.equals(2))
            .selectOneColumn(tCompany.name)
            .executeSelectOne()
        assertEquals(name, 'FOOFOO')

        i = await connection
            .deleteFrom(tCompany)
            .where(tCompany.id.equals(2))
            .executeDelete()
        assertEquals(i, 1)

        let maybe = await connection
            .selectFrom(tCompany)
            .where(tCompany.id.equals(2))
            .selectOneColumn(tCompany.name)
            .executeSelectNoneOrOne()
        assertEquals(maybe, null)

        let page = await connection
            .selectFrom(tCustomer)
            .select({
                id: tCustomer.id,
                name: tCustomer.firstName.concat(' ').concat(tCustomer.lastName)
            })
            .orderBy('id')
            .limit(2)
            .executeSelectPage()
        assertEquals(page, {
            count: 3,
            data: [
                { id: 1, name: 'John Smith' },
                { id: 2, name: 'Other Person' }
            ]
        })

        const customerCountPerCompanyWith = connection.selectFrom(tCompany)
            .innerJoin(tCustomer).on(tCustomer.companyId.equals(tCompany.id))
            .select({
                companyId: tCompany.id,
                companyName: tCompany.name,
                endsWithME: tCompany.name.endsWithInsensitive('me'),
                customerCount: connection.count(tCustomer.id)
            }).groupBy('companyId', 'companyName', 'endsWithME')
            .forUseInQueryAs('customerCountPerCompany')

        const customerCountPerAcmeCompanies = await connection.selectFrom(customerCountPerCompanyWith)
            .where(customerCountPerCompanyWith.companyName.containsInsensitive('ACME'))
            .select({
                acmeCompanyId: customerCountPerCompanyWith.companyId,
                acmeCompanyName: customerCountPerCompanyWith.companyName,
                acmeEndsWithME: customerCountPerCompanyWith.endsWithME,
                acmeCustomerCount: customerCountPerCompanyWith.customerCount
            })
            .executeSelectMany()
        assertEquals(customerCountPerAcmeCompanies, [
            { acmeCompanyId: 1, acmeCompanyName: 'ACME', acmeEndsWithME: true, acmeCustomerCount: 3 }
        ])

        i = await connection.increment(10)
        assertEquals(i, 11)

        await connection.appendToAllCompaniesName(' Cia.')

        name = await connection
            .selectFrom(tCompany)
            .where(tCompany.id.equals(1))
            .selectOneColumn(tCompany.name)
            .executeSelectOne()
        assertEquals(name, 'ACME Cia.')

        ii = await connection
            .insertInto(tCompany)
            .from(
                connection
                .selectFrom(tCompany)
                .select({
                    name: tCompany.name.concat(' 3')
                })
            )
            .returningLastInsertedId()
            .executeInsert()
        assertEquals(ii, [5, 6, 7])

        const updatedSmithFirstName = await connection.update(tCustomer)
            .set({
                firstName: 'Ron'
            })
            .where(tCustomer.id.equals(1))
            .returningOneColumn(tCustomer.firstName)
            .executeUpdateOne()
        assertEquals(updatedSmithFirstName, 'Ron')

        const oldCustomerValues = tCustomer.oldValues()
        const updatedLastNames = await connection.update(tCustomer)
            .set({
                lastName: 'Customer'
            })
            .where(tCustomer.id.equals(2))
            .returning({
                oldLastName: oldCustomerValues.lastName,
                newLastName: tCustomer.lastName
            })
            .executeUpdateOne()
        assertEquals(updatedLastNames, {oldLastName: 'Person', newLastName: 'Customer'})

        const deletedCustomers = await connection.deleteFrom(tCustomer)
            .where(tCustomer.id.greaterOrEquals(2))
            .returning({
                id: tCustomer.id,
                firstName: tCustomer.firstName,
                lastName: tCustomer.lastName
            })
            .executeDeleteMany()
        deletedCustomers.sort((a, b) => {
            return a.id - b.id
        })
        assertEquals(deletedCustomers, [{ id: 2, firstName: 'Other', lastName: 'Customer' }, { id:3, firstName: 'Jane', lastName: 'Doe' } ])

        let insertOneCustomers = await connection
            .insertInto(tCustomer)
            .values({ firstName: 'Other', lastName: 'Person', companyId: 1 })
            .returning({
                id: tCustomer.id,
                firstName: tCustomer.firstName,
                lastName: tCustomer.lastName
            })
            .executeInsertOne()
        assertEquals(insertOneCustomers, { id: 4, firstName: 'Other', lastName: 'Person' })

        const insertMultipleCustomers = await connection
            .insertInto(tCustomer)
            .values([
                { firstName: 'Other 2', lastName: 'Person 2', companyId: 1 },
                { firstName: 'Other 3', lastName: 'Person 3', companyId: 1 }
            ])
            .returning({
                id: tCustomer.id,
                firstName: tCustomer.firstName,
                lastName: tCustomer.lastName
            })
            .executeInsertMany()
        assertEquals(insertMultipleCustomers, [ { id: 5, firstName: 'Other 2', lastName: 'Person 2' }, { id: 6, firstName: 'Other 3', lastName: 'Person 3' }])

        insertOneCustomers = await connection
            .insertInto(tCustomer)
            .from(
                connection
                .selectFrom(tCustomer)
                .select({
                    firstName: tCustomer.firstName.concat(' 2'),
                    lastName: tCustomer.lastName.concat(' 2'),
                    companyId: tCustomer.companyId
                })
                .where(tCustomer.id.equals(1))
            )
            .returning({
                id: tCustomer.id,
                firstName: tCustomer.firstName,
                lastName: tCustomer.lastName
            })
            .executeInsertOne()
        assertEquals(insertOneCustomers, { id: 7, firstName: 'Ron 2', lastName: 'Smith 2' })

        i = await connection.update(tCustomer)
            .from(tCompany)
            .set({
                lastName: tCustomer.lastName.concat(' - ').concat(tCompany.name)
            })
            .where(tCustomer.companyId.equals(tCompany.id))
            .and(tCustomer.id.equals(1))
            .executeUpdate()
        assertEquals(i, 1)

        i = await connection.deleteFrom(tCustomer)
            .using(tCompany)
            .where(tCustomer.companyId.equals(tCompany.id))
            .and(tCustomer.id.equals(1))
            .executeDelete()
        assertEquals(i, 1)

        const smithLastNameUpdate = await connection.update(tCustomer)
            .from(tCompany)
            .set({
                lastName: 'Smith'
            })
            .where(tCustomer.companyId.equals(tCompany.id))
            .and(tCompany.name.equals('ACME Cia.'))
            .and(tCustomer.firstName.equals('Ron 2'))
            .returning({
                oldLastName: oldCustomerValues.lastName,
                newLastName: tCustomer.lastName
            })
            .executeUpdateOne()
        assertEquals(smithLastNameUpdate, {oldLastName: 'Smith 2', newLastName: 'Smith'})

        const smithLastNameUpdate2 = await connection.update(tCustomer)
            .from(tCompany)
            .set({
                lastName: tCustomer.lastName.concat(' - ').concat(tCompany.name)
            })
            .where(tCustomer.companyId.equals(tCompany.id))
            .and(tCompany.name.equals('ACME Cia.'))
            .and(tCustomer.firstName.equals('Ron 2'))
            .returning({
                oldLastName: oldCustomerValues.lastName,
                newLastName: tCustomer.lastName
            })
            .executeUpdateOne()
        assertEquals(smithLastNameUpdate2, {oldLastName: 'Smith', newLastName: 'Smith - ACME Cia.'})

        const smithLastNameUpdate3 = await connection.update(tCustomer)
            .from(tCompany)
            .set({
                lastName: 'Smith'
            })
            .where(tCustomer.companyId.equals(tCompany.id))
            .and(tCompany.name.equals('ACME Cia.'))
            .and(tCustomer.firstName.equals('Ron 2'))
            .returning({
                oldLastName: oldCustomerValues.lastName,
                newLastName: tCustomer.lastName.concat('/').concat(tCompany.name)
            })
            .executeUpdateOne()
        assertEquals(smithLastNameUpdate3, {oldLastName: 'Smith - ACME Cia.', newLastName: 'Smith/ACME Cia.'})

        // await connection.commit()
    } catch(e) {
        // Long running transactions are not supported by Prisma. See https://github.com/prisma/prisma/issues/1844
        //await connection.rollback()
        throw e
    }
}

main().finally(async () => {
    await prisma.$disconnect()
}).then(() => {
    console.log('All ok')
    process.exit(0)
}).catch((e) => {
    console.error(e)
    process.exit(1)
})

