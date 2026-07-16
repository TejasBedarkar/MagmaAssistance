import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.plant";

export async function listPlants(params = {}) {
  const data = await scCallGet(`${METHOD}.list_plants`, params, { silent: true });
  return data?.plants || [];
}

export async function getPlant(plantCode) {
  return scCallGet(`${METHOD}.get_plant`, { plant_code: plantCode }, { silent: true });
}

export async function createPlant(payload) {
  return scCall(`${METHOD}.create_plant`, payload);
}

export async function configurePlant(plantCode, payload) {
  return scCall(`${METHOD}.configure_plant`, { plant_code: plantCode, ...payload });
}

export async function setupPlantCapacity(plantCode, payload) {
  return scCall(`${METHOD}.setup_plant_capacity`, { plant_code: plantCode, ...payload });
}

export async function mapWarehousesToPlant(plantCode, warehouses) {
  return scCall(`${METHOD}.map_warehouses_to_plant`, {
    plant_code: plantCode,
    warehouses: JSON.stringify(warehouses),
  });
}

export async function mapProductsToPlant(plantCode, products) {
  return scCall(`${METHOD}.map_products_to_plant`, {
    plant_code: plantCode,
    products: JSON.stringify(products),
  });
}

export async function mapDepartmentsToPlant(plantCode, departments) {
  return scCall(`${METHOD}.map_departments_to_plant`, {
    plant_code: plantCode,
    departments: JSON.stringify(departments),
  });
}

export async function mapEmployeesToPlant(plantCode, employees) {
  return scCall(`${METHOD}.map_employees_to_plant`, {
    plant_code: plantCode,
    employees: JSON.stringify(employees),
  });
}

export async function getPlantCapacityAvailable(plantCode, params = {}) {
  return scCallGet(
    `${METHOD}.get_plant_capacity_available`,
    { plant_code: plantCode, ...params },
    { silent: true },
  );
}
