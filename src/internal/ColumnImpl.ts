import { ITableOrView, __getTableOrViewPrivate, __registerTableOrView } from "../utils/ITableOrView"
import type { Column, ColumnWithDefaultValue, ComputedColumn, OptionalColumn, PrimaryKeyAutogeneratedColumn, PrimaryKeyColumn, __ColumnPrivate } from "../utils/Column"
import type { TypeAdapter } from "../TypeAdapter"
import type { QueryColumns, SqlBuilder, ToSql } from "../sqlBuilders/SqlBuilder"
import { isValueSource, __getValueSourcePrivate } from "../expressions/values"
import { ValueSourceImpl } from "./ValueSourceImpl"
import { CustomBooleanTypeAdapter } from "../TypeAdapter"
import { ProxyTypeAdapter } from "./ProxyTypeAdapter"
import { isColumnObject, type } from "../utils/symbols"

export class ColumnImpl extends ValueSourceImpl implements Column, __ColumnPrivate, ToSql {
    [type]: 'column'
    [isColumnObject]: true = true
    __name: string
    __tableOrView: ITableOrView<any>
    __hasDefault: boolean = false
    __isPrimaryKey: boolean = false
    __isAutogeneratedPrimaryKey: boolean = false
    __isComputed = false
    __sequenceName?: string

    constructor(table: ITableOrView<any>, name: string, valueType: string, typeAdapter: TypeAdapter | undefined) {
        super(valueType, 'required', typeAdapter)
        this.__name = name
        this.__tableOrView = table
    }

    __toSql(sqlBuilder: SqlBuilder, params: any[]): string {
        return sqlBuilder._appendColumnName(this.__asColumn(), params)
    }

    __toSqlForCondition(sqlBuilder: SqlBuilder, params: any[]): string {
        return sqlBuilder._appendColumnNameForCondition(this.__asColumn(), params)
    }

    __asColumn(): this & Column {
        return (this as this & Column)
    }

    __asOptionalColumn(): this & OptionalColumn {
        this.__optionalType = 'optional'
        return (this as this & OptionalColumn)
    }

    __asColumnWithDefaultValue(): this & ColumnWithDefaultValue {
        this.__hasDefault = true
        return (this as this & ColumnWithDefaultValue)
    }

    __asOptionalColumnWithDefaultValue(): this & OptionalColumn & ColumnWithDefaultValue {
        this.__optionalType = 'optional'
        this.__hasDefault = true
        return (this as this & OptionalColumn & ColumnWithDefaultValue)
    }

    __asAutogeneratedPrimaryKey(): this & ColumnWithDefaultValue & PrimaryKeyColumn & PrimaryKeyAutogeneratedColumn {
        this.__hasDefault = true
        this.__isPrimaryKey = true
        this.__isAutogeneratedPrimaryKey = true
        return (this as this & ColumnWithDefaultValue & PrimaryKeyColumn & PrimaryKeyAutogeneratedColumn)
    }

    __asAutogeneratedPrimaryKeyBySequence(sequenceName: string): this & ColumnWithDefaultValue & PrimaryKeyColumn & PrimaryKeyAutogeneratedColumn {
        this.__hasDefault = true
        this.__isPrimaryKey = true
        this.__isAutogeneratedPrimaryKey = true
        this.__sequenceName = sequenceName
        return (this as this & ColumnWithDefaultValue & PrimaryKeyColumn & PrimaryKeyAutogeneratedColumn)
    }

    __asPrimaryKey(): this & PrimaryKeyColumn {
        this.__isPrimaryKey = true
        return (this as this & PrimaryKeyColumn)
    }

    __asComputedColumn(): this & ComputedColumn {
        this.__isComputed = true
        return (this as this & ComputedColumn)
    }

    __asOptionalComputedColumn(): this & OptionalColumn & ComputedColumn {
        this.__isComputed = true
        this.__optionalType = 'optional'
        return (this as this & OptionalColumn & ComputedColumn)
    }

    __registerTableOrView(requiredTablesOrViews: Set<ITableOrView<any>>): void {
        __getTableOrViewPrivate(this.__tableOrView).__registerTableOrView(requiredTablesOrViews)
    }

    __registerRequiredColumn(requiredColumns: Set<Column>, onlyForTablesOrViews: Set<ITableOrView<any>>): void {
        if (onlyForTablesOrViews.has(this.__tableOrView)) {
            requiredColumns.add(this)
        }
    }

    __getOldValues(): ITableOrView<any> | undefined {
        return __getTableOrViewPrivate(this.__tableOrView).__getOldValues()
    }
}

export function createColumnsFrom(columns: QueryColumns, target: QueryColumns, table: ITableOrView<any>) {
    for (const property in columns) {
        const column = columns[property]!
        if (isValueSource(column)) {
            const columnPrivate = __getValueSourcePrivate(column)
            let valueType = columnPrivate.__valueType
            let typeAdapter = columnPrivate.__typeAdapter
            if (typeAdapter instanceof CustomBooleanTypeAdapter) {
                // Avoid treat the column as a custom boolean
                typeAdapter = new ProxyTypeAdapter(typeAdapter)
            }
            const withColumn = new ColumnImpl(table, property, valueType, typeAdapter)
            withColumn.__optionalType = columnPrivate.__optionalType
            if (columnPrivate.__aggregatedArrayColumns) {
                withColumn.__aggregatedArrayColumns = columnPrivate.__aggregatedArrayColumns
                withColumn.__aggregatedArrayMode = columnPrivate.__aggregatedArrayMode
            }
            target[property] = withColumn
        } else {
            const newTarget = {}
            createColumnsFromInnerObject(column, target, table, property + '.')
            target[property] = newTarget
        }
    }
}

export function createColumnsFromInnerObject(columns: QueryColumns, target: QueryColumns, table: ITableOrView<any>, prefix: string) {
    const rule = getInnerObjetRuleToApply(columns)
    
    for (const property in columns) {
        const column = columns[property]!
        if (isValueSource(column)) {
            const columnPrivate = __getValueSourcePrivate(column)
            let valueType = columnPrivate.__valueType
            let typeAdapter = columnPrivate.__typeAdapter
            if (typeAdapter instanceof CustomBooleanTypeAdapter) {
                // Avoid treat the column as a custom boolean
                typeAdapter = new ProxyTypeAdapter(typeAdapter)
            }
            const withColumn = new ColumnImpl(table, prefix + property, valueType, typeAdapter)
            let optionalType = columnPrivate.__optionalType
            switch(rule) {
                case 1: // Rule 1, there is requiredInOptionalObject
                    if (optionalType === 'originallyRequired') {
                        optionalType = 'optional'
                    }
                    break
                case 2: // Rule 2: all from the same left join ignoring inner objects
                    if (optionalType === 'originallyRequired') {
                        optionalType = 'requiredInOptionalObject'
                    }
                    break
                case 3: // Rule 3: there is a required property
                    if (optionalType !== 'required') {
                        optionalType = 'optional'
                    }
                    break
                case 4: // Rule 4: the general rule
                    if (optionalType !== 'required') {
                        optionalType = 'optional'
                    }
                    break
            }
            withColumn.__optionalType = optionalType
            if (columnPrivate.__aggregatedArrayColumns) {
                withColumn.__aggregatedArrayColumns = columnPrivate.__aggregatedArrayColumns
                withColumn.__aggregatedArrayMode = columnPrivate.__aggregatedArrayMode
            }
            target[property] = withColumn
        } else {
            const newTarget = {}
            createColumnsFromInnerObject(column, target, table, prefix + property + '.')
            target[property] = newTarget
        }
    }
}

export function getInnerObjetRuleToApply(columns: QueryColumns): 1 | 2 | 3 | 4 {
    let containsRequired = false
    let contaisOriginallyRequired = false
    let innerObjectsAreRequired = true

    for (const property in columns) {
        const column = columns[property]!
        if (isValueSource(column)) {
            const columnPrivate = __getValueSourcePrivate(column)
            const optionalType = columnPrivate.__optionalType

            switch (optionalType) {
            case 'requiredInOptionalObject': 
                return 1 // Rule 1, there is requiredInOptionalObject
            case 'required':
                containsRequired = true
                break
            case 'originallyRequired':
                contaisOriginallyRequired = true
                break
            default: //do nothing
            }
        } else {
            if (getInnerObjetRuleToApply(column) === 3) {
                // This is the only case where the inner object is required
                innerObjectsAreRequired = true
            }
        }
    }

    if (contaisOriginallyRequired) {
        let firstRequiredTables = new Set<ITableOrView<any>>()
        let alwaysSameRequiredTablesSize : undefined | boolean = undefined

        for (const property in columns) {
            const column = columns[property]!
            if (!isValueSource(column)) {
                // ignore inner objects
                continue
            }

            const columnPrivate = __getValueSourcePrivate(column)
            if (alwaysSameRequiredTablesSize === undefined) {
                columnPrivate.__registerTableOrView(firstRequiredTables)
                alwaysSameRequiredTablesSize = true
            } else if (alwaysSameRequiredTablesSize) {
                let valueSourceRequiredTables = new Set<ITableOrView<any>>()
                columnPrivate.__registerTableOrView(valueSourceRequiredTables)
                const initialSize = firstRequiredTables.size
                if (initialSize !== valueSourceRequiredTables.size) {
                    alwaysSameRequiredTablesSize = false
                } else {
                    valueSourceRequiredTables.forEach(table => {
                        firstRequiredTables.add(table)
                    })
                    if (initialSize !== firstRequiredTables.size) {
                        alwaysSameRequiredTablesSize = false
                    }
                }
            }
        }

        // Evaluate rule 2: all from the same left join ignoring inner objects
        let onlyOuterJoin = true
        firstRequiredTables.forEach(table => {
            if (!__getTableOrViewPrivate(table).__forUseInLeftJoin) {
                onlyOuterJoin = false
            }
        })
        if (firstRequiredTables.size <= 0) {
            onlyOuterJoin = false
        }
        if (alwaysSameRequiredTablesSize && onlyOuterJoin) {
            return 2 // Rule 2: all from the same left join ignoring inner objects
        }
    }

    if (containsRequired || innerObjectsAreRequired) {
        return 3 // Rule 3: there is a required property
    }

    return 4 // Rule 4: the general rule
}